/**
 * @license GPL-3.0-or-later
 *
 * @Deno-PLC / Adapter-TCP
 *
 * Copyright (C) 2024 - 2025 Hans Schallmoser
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { batch, type Signal, signal } from "@deno-plc/signals";
import { getLogger, type Logger } from "@logtape/logtape";

/**
 * Describes the status of the connection
 */
export enum TCPAdapterConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
}

/**
 * Describes exact error
 */
export enum TCPAdapterConnectionDetails {
    NO_ERROR,
    UNKNOWN_ERROR,
    ECONNRESET,
    ECONNREFUSED,
    ETIMEDOUT,
    INTERRUPTED,
}

/**
 * (data: Uint8Array) => void
 */
export interface TCPAdapterCallback {
    (data: Uint8Array): void;
}

/**
 * (send_callback) => {@link TCPAdapterSession}
 */
export interface TCPAdapterSessionFactory {
    (send: TCPAdapterCallback): TCPAdapterSession;
}

/**
 * Represents one session (= one connection attempt)
 * Protocol state machines should be implemented here to ensure they are reset for every connection
 */
export interface TCPAdapterSession {
    recv(data: Uint8Array): void;
    destroy(): void;
}

/**
 * Options for {@link TCPAdapter}
 */
export interface TCPAdapterOptions {
    /**
     * IP (v4/v6) or hostname, use "" or "!" to disable (useful for test mocking)
     */
    host: string;

    /**
     * TCP port
     */
    port: number;

    sessionFactory: TCPAdapterSessionFactory;

    /**
     * enable logging via logtape
     * @default true
     */
    verbose?: boolean;

    /**
     * Displayed in the logs
     */
    label?: string;
}

/**
 * Handles automatic reconnection, connection loss, etc.
 */
export class TCPAdapter {
    constructor(
        readonly options: TCPAdapterOptions,
    ) {
        this.host = options.host;
        this.port = options.port;
        this.verbose = options.verbose ?? true;
        this.#label = options.label ?? `${options.host}:${options.port}`;
        this.#logger = getLogger(["app", "deno-plc", "tcp", this.#label]);
        this.#session_factory = options.sessionFactory;

        if (options.host && options.host !== "!") {
            this.#loop();
        }
    }

    /**
     * IP (v4/v6) or hostname
     */
    readonly host: string;

    /**
     * TCP port
     */
    readonly port: number;

    /**
     * enable logging via logtape
     */
    public verbose: boolean;

    readonly #label: string;

    readonly #logger: Logger;

    readonly #session_factory: TCPAdapterSessionFactory;

    /**
     * connection status {@link TCPAdapterConnectionStatus}
     */
    readonly status: Signal<TCPAdapterConnectionStatus> = signal(
        TCPAdapterConnectionStatus.DISCONNECTED,
    );

    /**
     * connection status detail {@link TCPAdapterConnectionDetails}
     */
    readonly details: Signal<TCPAdapterConnectionDetails> = signal(
        TCPAdapterConnectionDetails.NO_ERROR,
    );

    /**
     * connection duration statistics
     */
    readonly #stats_conn_duration: number[] = [];

    /**
     * average connection duration
     */
    readonly avg_conn_duration: Signal<number> = signal(NaN);

    #current_conn: Deno.TcpConn | null = null;

    #handle_err(err: unknown) {
        batch(() => {
            this.status.value = TCPAdapterConnectionStatus.DISCONNECTED;
            let logged = false;
            if (err instanceof Error) {
                if (err.name === "ConnectionRefused") {
                    this.details.value =
                        TCPAdapterConnectionDetails.ECONNREFUSED;
                } else if (err.name === "ConnectionReset") {
                    this.details.value = TCPAdapterConnectionDetails.ECONNRESET;
                } else if (err.name === "Interrupted") {
                    this.details.value =
                        TCPAdapterConnectionDetails.INTERRUPTED;
                } else if (err.name === "TimedOut") {
                    this.details.value = TCPAdapterConnectionDetails.ETIMEDOUT;
                } else if (err.name === "ConnectionAborted") {
                    this.details.value = TCPAdapterConnectionDetails.NO_ERROR;
                } else {
                    this.#logger.error`unknown error ${err.name}`;
                    logged = true;
                    this.details.value =
                        TCPAdapterConnectionDetails.UNKNOWN_ERROR;
                }
                if (this.verbose && !logged) {
                    this.#logger.error`error ${err.name}`;
                }
            } else {
                this.#logger.error`unknown error ${err}`;
                this.details.value = TCPAdapterConnectionDetails.UNKNOWN_ERROR;
            }
        });
    }

    async #loop() {
        const connStart = performance.now();
        let session: TCPAdapterSession | null = null;
        try {
            if (this.verbose) {
                this.#logger.info`connecting...`;
            }
            this.status.value = TCPAdapterConnectionStatus.CONNECTING;

            const conn = await Deno.connect({
                hostname: this.host,
                transport: "tcp",
                port: this.port,
            });
            this.#current_conn = conn;

            // this makes sense for most control applications
            conn.setNoDelay(true);
            conn.setKeepAlive(true);

            if (this.verbose) {
                this.#logger.info`connected`;
            }
            batch(() => {
                this.status.value = TCPAdapterConnectionStatus.CONNECTED;
                this.details.value = TCPAdapterConnectionDetails.NO_ERROR;
            });

            session = this.#session_factory((data) => {
                // socket write callback
                if (conn === this.#current_conn) {
                    conn.write(data).catch((err) => {
                        this.#handle_err(err);
                    });
                } else {
                    this.#logger
                        .fatal`attempt to write to closed socket failed, please check your driver code`;
                }
            });

            for await (const data of conn.readable) {
                session.recv(data);
            }
        } catch (err) {
            this.#handle_err(err);
        }
        this.status.value = TCPAdapterConnectionStatus.DISCONNECTED;
        this.#current_conn = null;

        // store the duration of this connection attempt
        this.#stats_conn_duration.push(performance.now() - connStart);
        // limit statistics to 6 items
        while (this.#stats_conn_duration.length > 6) {
            this.#stats_conn_duration.shift();
        }
        // average
        this.avg_conn_duration.value = this.#stats_conn_duration
            .reduce((prev, curr) => prev + curr, 0) /
            this.#stats_conn_duration.length;

        setTimeout(
            () => {
                this.#loop();
            },
            // prevent nearly infinity loop when the device instantly rejects the request
            Math.min(0, 5000 - this.avg_conn_duration.value),
        );

        // cleanup
        session?.destroy();
    }
}

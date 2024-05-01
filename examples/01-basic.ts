/**
 * @license GPL-3.0-or-later
 *
 * @Deno-PLC / Adapter-TCP
 *
 * Copyright (C) 2024 Hans Schallmoser
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

import {
    TCPAdapter,
    type TCPAdapterCallback,
    type TCPAdapterSession,
} from "../mod.ts";

interface MyProtocolAdapterOptions {
    host: string;
    port?: number;
    verbose?: boolean;
}

class MyProtocolAdapter extends TCPAdapter {
    constructor(options: MyProtocolAdapterOptions) {
        super({
            sessionFactory: (cb) => new MyProtocolAdapterSession(this, cb),
            port: 1234,
            ...options,
        });
    }
}

class MyProtocolAdapterSession implements TCPAdapterSession {
    constructor(readonly adapter: MyProtocolAdapter, send: TCPAdapterCallback) {
        this.#send = send;

        setTimeout(() => {
            // TX
            this.#send(new TextEncoder().encode("Client Hello"));
        });
    }
    recv(data: Uint8Array): void {
        // RX
        console.log(`[Client] [RX] ${new TextDecoder().decode(data)}`);
    }
    destroy(): void {
        // nothing to cleanup
    }
    readonly #send: TCPAdapterCallback;
}

const _adapter = new MyProtocolAdapter({
    // using 127.0.0.1 is faster than localhost, because it doesn't involve a dns lookup
    host: "127.0.0.1",
    verbose: true,
});

// demo server
for await (
    const conn of Deno.listen({
        port: 1234,
    })
) {
    console.log(
        `[Server] new client ${conn.remoteAddr.hostname}:${conn.remoteAddr.port}`,
    );
    conn.write(new TextEncoder().encode("Server Hello"));
    for await (const msg of conn.readable) {
        console.log(`[Server] [RX] ${new TextDecoder().decode(msg)}`);
    }
}

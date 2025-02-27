# [Deno-PLC](https://github.com/deno-plc) / [Adapter-TCP](https://jsr.io/@deno-plc/adapter-tcp)

Base adapter for devices that can be controlled via a TCP socket

## Installation

[Use JSR: ![JSR](https://jsr.io/badges/@deno-plc/adapter-tcp)](https://jsr.io/@deno-plc/adapter-tcp)

## Usage

```ts
import {
    TCPAdapter,
    TCPAdapterCallback,
    TCPAdapterSession,
} from "@deno-plc/adapter-tcp";

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
            label: `MyProtocol ${options.host}`,
            ...options,
        });
    }
}

class MyProtocolAdapterSession implements TCPAdapterSession {
    constructor(readonly adapter: MyProtocolAdapter, send: TCPAdapterCallback) {
        this.#send = send;
        setTimeout(() => {
            // TX
            this.#send(new TextEncoder().encode("Hello"));
        });
    }
    readonly #send: TCPAdapterCallback;
    recv(data: Uint8Array): void {
        // RX
    }
    destroy(): void {
        // cleanup
    }
}
```

For more see `examples/`

## Logging

All events (connect/disconnect/errors) can be logged with
[logtape](https://logtape.org/). You can disable it by setting
`verbose = false`, simply not configuring logtape or setting a log level > info
for `app`>`deno-plc`>`tcp`>`[options.label]`

## License

Copyright (C) 2024 - 2025 Hans Schallmoser

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

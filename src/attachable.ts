import * as fs from 'fs';
import * as net from 'net';
import {spawn} from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { fstat } from 'fs';

export class Attachable extends EventEmitter {
	public kill: Function;
	public port: Number | null;

	// This is a simple proxy server. When the extension launches a
	// debuggee, it launches a server that listens on a port, then
	// it launches the debuggee with an instruction to connect to
	// that port. Later on, the debuggee might `fork` a child. The
	// child runs under a new instance of the debugger, which will
	// eventually attempt to create a new connection to that port.
	//
	// In order to show this separate instance in the vscode user
	// interface (in a separate debug console, in an extended call
	// stack hierarchy) a new debug session has to be launched. A
	// new debug session implies a new instance of `perlDebug.ts`.
	// This new instance will typically be in a separate process.
	//
	// So we have one instance of `perlDebug.ts` that accepts new
	// connections from the debugger, and another instance that is
	// supposed to connect to connections accepted by the other
	// process. There is no easy and portable way to hand off the
	// socket from one process to the other.
	//
	// So another level of indirection is added, the `perlDebug.ts`
	// instance that accepts the secondary connection spawns a new
	// proxy server that the new `perlDebug.ts` process can connect
	// to. An `Attachable` encapsulates the proxying server. The
	// new `perlDebug.ts` process then initiates an `AttachSession`
	// that connects to the `Attachable`,

	constructor(base: net.Socket) {
		super();

		// Keep track of the chat clients
		let client: net.Socket;

		const server = net.createServer((socket) => {
			const name = `${socket.remoteAddress}:${socket.remotePort}`;

			if (!client) {
				client = socket;
			} else {
				// Already have a client connected, lets close and notify user
				socket.destroy('Remote debugger already connected!');
			}

			base.on('data', data => {
				if (!socket.write(data)) {
					base.pause();
				}
			});

			socket.on('data', data => {
				if (!base.write(data)) {
					socket.pause();
				}
			});

			socket.on('drain', () => {
				base.resume();
			});

			base.on('drain', () => {
				socket.resume();
			});

			base.on('close', error => {
				socket.destroy();
			});

			socket.on('close', error => {
				base.destroy();
				this.kill();
			});
		});

		// Listen to port make it remotely available
		server.listen(0, 'localhost', () => {
			this.port = server.address().port;
			this.emit('listening', server.address());
		});

		server.on('error', data => {
			this.emit('error', data);
			this.kill();
		});

		this.kill = () => {

			if (client) {
				client.removeAllListeners();
				client.destroy();
				client = null;
			}

			server.removeAllListeners();
			server.close();
			this.removeAllListeners();

		};

	}
}

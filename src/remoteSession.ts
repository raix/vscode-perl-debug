import * as net from 'net';
import {spawn} from 'child_process';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession } from './session';
import { debuggerSignature } from './regExp';
import { Attachable } from './attachable';

export class RemoteSession extends EventEmitter implements DebugSession {
	public stdin: Writable;
	public stdout: Readable;
	public stderr: Readable;
	public kill: Function;
	public title: Function;
	public port: Number | null;

	constructor(
		port: number,
		bindAddress: string = "0.0.0.0",
		sessions: string = 'single'
	) {
		super();

		// Keep track of the chat clients
		let client: net.Socket;

		const attachables: Attachable[] = [];

		this.stdin = new Writable({
			write(chunk, encoding, callback) {
				if (client) {
					client.write(chunk);
					callback();
				}
				// FIXME(bh): "The callback method must be called to signal
				// either that the write completed successfully or failed
				// with an error. The first argument passed to the callback
				// must be the Error object if the call failed or null if
				// the write succeeded." - nodejs documentation
			},
		});

		this.stdout = new Readable({
			read() {},
		});
		this.stderr = new Readable({
			read() {},
		});

		const server = net.createServer((socket) => {
			const name = `${socket.remoteAddress}:${socket.remotePort}`;

			if (!client) {
				client = socket;
				this.stdout.push(`Remote debugger at "${name}" connected at port ${port}.`);
			} else {

				if (sessions && sessions !== 'single') {

					// When a debuggee calls `fork()` the Perl debugger will
					// fork the debuggee and try to connect to the same port
					// the parent was connected to. While vscode does support
					// multi-target/multi-process debugging, it needs a single
					// debug adapter process for each debuggee process. And it
					// is not possible to pass sockets past process boundaries.

					// So we accept the connection here and offer a proxy to it
					// to the perl-debug extension, informing it that a new one
					// is available through a custom event. The `Attachable` is
					// the proxy. The extension receives the custom event and
					// starts a new debug session, which will then connect to
					// the proxy in order to interact with the debugger. There
					// can be proxy chains if a child forks into grandchildren.

					this.stdout.push(`Attachable debugger at "${name}" connected at port ${port}.`);

					const attachable = new Attachable(socket);

					attachables.push(attachable);

					attachable.on('listening', address => {
						this.emit('perl-debug.attachable.listening', {
							src: {
								address: socket.remoteAddress,
								port: socket.remotePort,
							},
							via: socket.address(),
							dst: address,
						});
					});

					return;

				} else {
					// Already have a client connected, lets close and notify user
					this.stdout.push(`Warning: Additional remote client tried to connect "${name}".`);
					socket.destroy('Remote debugger already connected!');
				}

			}

			socket.on('data', data => {
				// const str = data.toString('utf8');
				// const signature = str.split('\n').pop();
				// xxx: We should figure out a more stable way of differentiating between
				// command result and application output
				this.stderr.push(data); // xxx: For now we don't forward application output
				/*  if (debuggerSignature.test(signature)) {
					this.stderr.push(data);
				} else {
					this.stdout.push(data);
				}*/
			});

			socket.on('end', data => {
				this.stdout.push(`Connection closed by "${name}"`);
				this.emit('close', data);

				// NOTE(bh): This used to call `this.kill()`, but in remote
				// debugging, when using the `R`estart command, the debugger
				// will close the connection and reconnect. To support that,
				// we simply note that no client is connected anymore, which
				// allows the code above to accept new connections.
				client = null;

			});

			socket.on('error', data => {
				this.emit('error', data);
			});
		});

		// Listen to port make it remotely available
		server.listen(port, bindAddress, () => {
			this.port = server.address().port;
			this.emit('listening', () => {});
		});

		server.on('error', data => {
			this.emit('error', data);
			this.kill();
		});

		this.kill = () => {

			// FIXME(bh): Do we actually want to kill the attachables
			// when the main session is going away?
			attachables.forEach(x => x.kill());

			server.removeAllListeners();
			this.removeAllListeners();
			this.stdin.removeAllListeners();
			this.stdout.removeAllListeners();
			this.stderr.removeAllListeners();

			if (client) {
				client.destroy();
				client = null;
			}

			server.close();
		};
		this.title = () => {
			if (server && client) {
				return `${server.address().address}:${server.address().port
					} serving ${client.remoteAddress}:${client.remotePort}`;
			} else {
				return "Inactive RemoteSession";
			}
		};

	}
}

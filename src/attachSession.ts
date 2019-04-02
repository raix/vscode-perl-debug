import * as fs from 'fs';
import * as net from 'net';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import { DebugSession } from './session';

export class AttachSession extends EventEmitter implements DebugSession {
	public stdin: Writable;
	public stdout: Readable;
	public stderr: Readable;
	public kill: Function;
	public title: Function;
	public port: Number | null;

	constructor(port: number, address: string = "localhost") {
		super();

		const client: net.Socket = new net.Socket();

		client.connect(port, address, () => {
			this.emit('connect');
			console.log('connect!');
		});

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

		client.on('data', data => {
			this.stderr.push(data);
		});

		client.on('close', error => {
			this.emit('close', error);
			this.kill();
		});

		client.on('error', data => {
			this.emit('error', data);
			this.kill();
		});

		this.title = () => `${client.localAddress}:${client.localPort
			} attached to ${client.remoteAddress}:${client.remotePort}`;

		this.kill = () => {
			if (client) {
				client.removeAllListeners();
				client.destroy();
			}
			this.removeAllListeners();
		};

	}
}

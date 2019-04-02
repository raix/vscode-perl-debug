/**
 * This file contains the stream catcher
 * it's basically given an input and out stream
 * it takes requests and generates a response from the streams
 */

 import * as fs from 'fs';

import {Writable, Readable} from 'stream';
import * as RX from './regExp';
import { EventEmitter } from 'events';

interface RequestTask {
	command: string | null,
	resolve: Function,
	reject: Function,
}

export class StreamCatcher extends EventEmitter {
	public debug: boolean = false;
	private requestQueue: RequestTask[] = [];
	private requestRunning: RequestTask | null = null;

	private buffer: string[] = [''];

	public input: Writable;

	logDebug(...args: any[]) {
		if (this.debug) {
			console.log(...args);
		}
	}

	constructor() {
		super();
	}

	async launch(input: Writable, output: Readable): Promise<string[]> {
		this.input = input;

		let lastBuffer = '';
		let timeout: NodeJS.Timer | null = null;
		output.on('data', (buffer) => {

			this.logDebug('RAW:', buffer.toString());
			this.emit('perl-debug.streamcatcher.data', buffer.toString());

			const data = lastBuffer + buffer.toString();
			const lines = data.split(/\r\n|\r|\n/);
			const firstLine = lines[0];
			const lastLine = lines[lines.length - 1];
			const commandIsDone = RX.lastCommandLine.test(lastLine);

			// xxx: Windows restart workaround
			// the windows perl debugger doesn't end the current restart request so we have to
			// simulate a proper request end.
			if ((/^win/.test(process.platform) && RX.restartWarning.test(firstLine)) || timeout) {

				if (RX.restartWarning.test(firstLine)) {
					this.logDebug('RAW> Waiting to fake end of restart request');
				}

				if (timeout) {
					clearTimeout(timeout);
				}
				timeout = setTimeout(() => {
					timeout = null;
					if (this.requestRunning) {
						this.logDebug('RAW> Fake end of restart request');
						// xxx: We might want to simulate all the restart output
						this.readline('   DB<0> ');
					}
				}, 500);
			}

			if (/\r\n|\r|\n$/.test(data) || commandIsDone) {
				lastBuffer = '';
			} else {
				lastBuffer = lines.pop();
			}
			lines.forEach(line => this.readline(line));
		});
		output.on('close', () => {
			// xxx: Windows perl debugger just exits on syntax error without "DB<n>"
			// If theres stuff left in the buffer we push it and end the request.
			if (this.requestRunning) {
				this.logDebug('RAW> Fake end of request');
				this.readline(lastBuffer);
				this.readline('Debugged program terminated.  Use q to quit or R to restart,');
				this.readline('use o inhibit_exit to avoid stopping after program termination,');
				this.readline('h q, h R or h o to get additional info.');
				this.readline('   DB<0> ');
			}
		});

		return this.request(null);
	}

	readline(line) {
		this.logDebug('line:', line);
		// this.logDebug('data:', [...line]);
		this.buffer.push(line);
		// Test for command end
		if (RX.lastCommandLine.test(line)) {
			this.logDebug('END:', line);
			const data = this.buffer;
			this.buffer = [];
			// xxx: We might want to verify the DB nr and the cmd number
			this.resolveRequest(data);
		}
	}

	resolveRequest(data) {
		const req = this.requestRunning;
		if (req) {
			if (req.command) {
				data.unshift(req.command);
			}

			req.resolve(data);
			// Reset state making room for next task
			this.buffer = [];
			this.requestRunning = null;
		}
		this.nextRequest();
	}

	nextRequest() {
		if (!this.requestRunning && this.requestQueue.length) {
			// Set new request
			this.requestRunning = this.requestQueue.shift();
			// this.logOutput(`NEXT: ${this.requestRunning.command}\n`);
			// a null command is used for the initial run, in that case we don't need to
			// do anything but listen
			if (this.requestRunning.command !== null) {
				const data = `${this.requestRunning.command}\n`;
				this.emit('perl-debug.streamcatcher.write', data);
				this.input.write(data);
			}
		}
	}

	request(command: string | null): Promise<string[]> {
		this.logDebug(command ? `CMD: "${command}"` : 'REQ-INIT');
		return new Promise((resolve, reject) => {
			// Add our request to the queue
			this.requestQueue.push({
				command,
				resolve,
				reject
			});

			this.nextRequest();
		});
	}

	destroy() {
		this.removeAllListeners();
		return Promise.resolve();
	}
}

/**
 * This file contains the stream catcher
 * it's basically given an input and out stream
 * it takes requests and generates a response from the streams
 */

import {Writable, Readable} from 'stream';
import * as RX from './regExp';

interface RequestTask {
	command: string | null,
	resolve: Function,
	reject: Function,
}

export class StreamCatcher {
	public debug: boolean = false;
	private requestQueue: RequestTask[] = [];
	private requestRunning: RequestTask | null = null;

	private buffer: string[] = [''];

	// xxx: consider removing ready - the user should not have to care about that...
	public ready: boolean = false;
	private readyListeners = [];
	private readyResponse: string[];

	public input: Writable;

	constructor() {
			// Listen for a ready signal
			const result = this.request(null)
				.then((res) => {
					if (this.debug) console.log('ready', res);
					this.readyResponse = res;
					this.ready = true;
					this.readyListeners.forEach(f => f(res));
				});

	}

	launch(input: Writable, output: Readable) {
		this.input = input;

		let lastBuffer = '';
		let timeout: NodeJS.Timer | null = null;
		output.on('data', (buffer) => {
			if (this.debug) console.log('RAW:', buffer.toString());
			const data = lastBuffer + buffer.toString();
			const lines = data.split(/\r\n|\r|\n/);
			const lastLine = lines[lines.length - 1];
			const commandIsDone = RX.lastCommandLine.test(lastLine);

			// xxx: Windows restart workaround
			// the windows perl debugger doesn't end the current restart request so we have to
			// simulate a proper request end.
			if ((/^win/.test(process.platform) && RX.restartWarning.test(lastLine)) || timeout) {
				if (this.debug && RX.restartWarning.test(lastLine)) console.log('RAW> Waiting to fake end of restart request');
				if (timeout) {
					clearTimeout(timeout);
				}
				timeout = setTimeout(() => {
					timeout = null;
					if (this.requestRunning) {
						if (this.debug) console.log('RAW> Fake end of restart request');
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
				if (this.debug) console.log('RAW> Fake end of request');
				this.readline(lastBuffer);
				this.readline('Debugged program terminated.  Use q to quit or R to restart,');
				this.readline('use o inhibit_exit to avoid stopping after program termination,');
				this.readline('h q, h R or h o to get additional info.');
				this.readline('   DB<0> ');
			}
		});
	}

	readline(line) {
		if (this.debug) console.log('line:', line);
		// if (this.debug) console.log('data:', [...line]);
		this.buffer.push(line);
		// Test for command end
		if (RX.lastCommandLine.test(line)) {
			if (this.debug) console.log('END:', line);
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
				this.input.write(`${this.requestRunning.command}\n`);
			}
		}
	}

	request(command: string | null): Promise<string[]> {
		if (this.debug) console.log(command ? `CMD: "${command}"` : 'REQ-INIT');
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

	onReady(f) {
		if (this.ready) {
			f(this.readyResponse);
		} else {
			this.readyListeners.push(f);
		}
	}

	isReady(): Promise<string[]> {
		return new Promise(resolve => this.onReady(res => resolve(res)));
	}

	destroy() {
		return Promise.resolve();
	}
}
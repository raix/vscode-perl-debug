import assert = require('assert');
import * as Path from 'path';
import * as fs from 'fs';
import {DebugClient} from 'vscode-debugadapter-testsupport';
import {DebugProtocol} from 'vscode-debugprotocol';
import { Subject } from 'await-notify';

describe('multisession support', () => {

	const DEBUG_ADAPTER = './out/debugAdapter.js';

	const PROJECT_ROOT = Path.dirname(Path.dirname(__dirname));
	const DATA_ROOT = Path.join(PROJECT_ROOT, 'src', 'tests', 'data');

	const defaultLaunchConfig = {
		type: 'perl',
		request: 'launch',
		exec: 'perl',
		execArgs: [],
		name: 'Perl-Debug',
		root: DATA_ROOT,
		inc: [],
		args: [],
		stopOnEntry: false,
		console: 'none',
		trace: false,
		debugRaw: true,
	};

	const Configuration = (obj: Object) => {
		return Object.assign({}, defaultLaunchConfig, obj);
	};

	let mainDc: DebugClient;

	beforeEach(async () => {
		mainDc = new DebugClient('node', DEBUG_ADAPTER, 'perl');
		await mainDc.start();
	});

	afterEach(() => {
		mainDc.stop();
	});

	describe('launch', () => {

		it('forked child can connect', async () => {

			mainDc.on('perl-debug.streamcatcher.data', (x) => {
				// useful for debugging: console.log(x);
			});

			const attached = new Subject();

			mainDc.on('perl-debug.attachable.listening', async (evt) => {

				attached.notify();

				const childDc = new DebugClient('node', DEBUG_ADAPTER, 'perl');

				await Promise.all([
					childDc.waitForEvent('initialized'),
					childDc.launch(Configuration({
						type: 'perl',
						request: 'launch',
						name: `auto ${evt.body.src.address}:${evt.body.src.port}`,
						port: evt.body.dst.port,
						console: "_attach",
					})),
					// stopped after fork() returns in the child
					childDc.assertStoppedLocation('postfork', {
						line: 3,
					}),
				]);

				childDc.stop();

			});

			await Promise.all([
				mainDc.waitForEvent('initialized'),
				mainDc.launch(Configuration({
					program: "fork.pl",
					stopOnEntry: true,
					console: 'none',
					sessions: 'break',
				})),
				mainDc.assertStoppedLocation('entry', {
					line: 1
				}),
			]);

			await Promise.all([
				mainDc.continueRequest({
					threadId: undefined
				}),
				attached
			]);

		});
	});
});

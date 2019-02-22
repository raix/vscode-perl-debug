import assert = require('assert');
import * as Path from 'path';
import { perlDebuggerConnection, RequestResponse } from '../adapter';
import { LocalSession } from '../localSession';
import { LaunchOptions } from '../session';

const PROJECT_ROOT = Path.join(__dirname, '../../');
const DATA_ROOT = Path.join(PROJECT_ROOT, 'src/tests/data/');

const FILE_TEST_PL = 'slow_test.pl';

const launchOptions = {
	env: {
		PATH: process.env.PATH || '',
		PERL5LIB: process.env.PERL5LIB || '',
	},
};

function setupDebugger(
	conn: perlDebuggerConnection,
	file: string,
	cwd: string,
	args: string[],
	launchOptions: LaunchOptions
): [Promise<RequestResponse>, LocalSession] {

	// Not to conflict with VS Code jest ext
	const port = 5000 + Math.round(Math.random()*100);
	// Listen for remote debugger session
	const server = conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], {
		...launchOptions,
		port, // Trigger server
	});
	// Start "remote" debug session
	const local = new LocalSession(FILE_TEST_PL, DATA_ROOT, [], {
		...launchOptions,
		env: {
			...launchOptions.env,
			 // Trigger remote debugger
			PERLDB_OPTS: `RemotePort=localhost:${port}`,
		},
	});

	return [server, local];

}

describe('Perl debugger connection', () => {

	let conn: perlDebuggerConnection;

	beforeEach(() => {
		conn = new perlDebuggerConnection();
		return conn.initializeRequest();
	});

	afterEach(() => {
		conn.destroy();
		conn = null;
	});

	it('Should be able to get remote expression values from ' + FILE_TEST_PL, async () => {

		const [ server, local ] = setupDebugger(
			conn, FILE_TEST_PL, DATA_ROOT, [], launchOptions
		);

		// Wait for result
		const res = await server;

		// Ask Perl for the PID of the Perl process
		const expressionValue = await conn.getExpressionValue('$$');

		// Cleanup
		local.kill();
		conn.perlDebugger.kill();

		assert.equal(Number.parseInt(expressionValue), local.pid);
		assert.equal(res.finished, false);
		assert.equal(res.exception, false);
		assert.equal(res.ln, 7); // The first code line in test.pl is 7
	});

	it.skip('Should be able to get loaded scripts and their source code from' + FILE_TEST_PL, async () => {

		const [ server, local ] = setupDebugger(
			conn, FILE_TEST_PL, DATA_ROOT, [], launchOptions
		);

		// TODO(bh): Test for `loadedSourcesRequest` and `sourceRequest`.
		// Those would need a `DebugClient` and/or a `DebugSession`. Not
		// Clear how to get those here, or how to restructure the tests.

	});


});

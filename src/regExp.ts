export const colors = /\u001b\[([0-9]+)m|\u001b/g;

// TODO(bh): Perhaps unify this with debuggerSignature by making
// whitespace entirely optional in the latter regular expression?
export const db = /^(\[(pid=)?[0-9\->]+\])?(\[\d+\])?DB\<+([0-9]+)\>+$/;

export const restartWarning = /^Warning: some settings and command-line options may be lost!/;

export const breakPoint = {
	// The condition my condition was in eg.:
	// '    break if (1)'
	condition: /^    break/,
	// This looks like a filename eg.:
	// 'test.pl:'
	filename: /^([a-zA-Z.\_\-0-9\/]+)\:$/,
	// Got a line nr eg.:
	// '5:\tprint "Testing\\n";'
	ln: /^ ([0-9]+):/,
}

export function cleanLine(line: string) {
	return line.replace(colors, '').replace(/\s|(\\b)/g, '').replace('\b', '');
}

export function isGarbageLine(line: string) {
	return cleanLine(line) === '' || lastCommandLine.test(line);
}

export const lastCommandLine = {
	// Improve this function... I think the test is the issue
	test(line: string) {
		const stripped = cleanLine(line);
		// console.log(`${db.test(stripped)} DB: "${stripped}"`);

		/*const chars = new Array([...stripped]);
		console.log(`CHARS:`, chars);*/

		return db.test(stripped);
	},

	match(line: string) {
		const stripped = cleanLine(line);
		return stripped.match(db);
	}
};

export const fileMatch = /^[a-zA-Z]+::\((.+):([0-9]+)\):($|\t.*)/;

export const fileMatchException = /at ([a-zA-Z\._-]+) line ([0-9]+)\./;

export const codeErrorSyntax = /^syntax error at (\S+) line ([0-9]+), near ([\S|\s]+)/;

export const codeErrorRuntime = /([\S|\s]+) at (\S+) line ([0-9]+)\.$/;

// EG. PadWalker for scope investigation
export const codeErrorMissingModule = /^(\S+) module not found - please install$/;

// Optional `pidprompt` like `[pid=123->456->789]` followed by an
// optional thread id, followed by `DB`, and for nested debuggers
// the number of `<` and `>` corresponds to the level of nesting.
export const debuggerSignature = /^(\[pid=[0-9>\-]+\])? (\[\d+\])? DB<+[0-9]+>+ $/;

export const watchpointChange = /^Watchpoint (\d+):\t(.*) changed:/;
export const watchpointOldval = /^\s+old value:\t'(.*)'/;
export const watchpointNewval = /^\s+new value:\t'(.*)'/;

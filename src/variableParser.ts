/*

{
	'HASH(0x7f92619e1b00)': [
		{
			name: 'bar',
			value: 12,
			type: 'integer',
			variablesReference: 0,
		}
	]
	0: [
		{
			name: '$hello',
			value: 'HASH(0x7f92619e1b00)',
			type: 'object',
			variablesReference: 'HASH(0x7f92619e1b00)',
		}
	]
}

*/

function getIndent(text: string) {
	return text.match(/^\s*/)[0].length;
}

const indent = 3; // Perl debugger variable indent

function variableType(value) {
	if (/^[0-9]+/.test(value)) return 'integer';
	if (/^[0-9.,]+/.test(value)) return 'float';
	if (/true|false/.test(value)) return 'boolean';
	if (/^\'/.test(value)) return 'string';
	if (/^ARRAY/.test(value)) return 'array';
	if (/^HASH/.test(value)) return 'object';
	return 'unknown';
}

function variableReference(value) {
	if (/^ARRAY|HASH/.test(value)) return value;
	return '0';
}

function createVariable(name, value) {
	return {
		name,
		value,
		type: variableType(value),
		variablesReference: variableReference(value)
	};
}

export default function(data: string[], scopeName: string = '0') {
	const result = {};
	const context: string[] = [scopeName];
	let lastReference = scopeName;
	// console.log('-----> SCOPE', scopeName);
	data.forEach(line => {
		const contextIndent = context.length - 1;
		const lineIndent = getIndent(line) / indent;

		try {
			const [name, value] = line.match(/^([\s+]{0,})(\S+) =?>? ([\S\s]+)/).splice(2, 2);
			if (contextIndent > lineIndent) {
				context.splice(0, contextIndent - lineIndent);
			} else if (contextIndent < lineIndent) {
				context.unshift(lastReference);
			}
			// Check the indent poping / pushing context
			// console.log(lineIndent, line, `Context: "${context[0]}"`);

			// Ensure reference container
			if (typeof result[context[0]] === 'undefined') {
				result[context[0]] = [];
			}

			// Push variable to reference container
			result[context[0]].push(createVariable(name, value));

			// Post
			lastReference = value;
		} catch(err) {
			// TODO: Figure out why this happens...
			// console.log('ERR:', line);
		}
	});

	// console.log(result);

	return result;
}

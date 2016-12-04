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

export function variableType(value) {
	if (/^\'?(\-)?[0-9]+\'?$/.test(value)) return 'integer';
	if (/^\'?(\-)?[0-9.,]+\'?$/.test(value)) return 'float';
	if (/true|false/.test(value)) return 'boolean';
	if (/^\'/.test(value)) return 'string';
	if (/^ARRAY/.test(value)) return 'array';
	if (/^HASH/.test(value)) return 'object';
	return 'unknown';
}

function variableReference(value: string): string {
	if (/^ARRAY|HASH/.test(value)) return value;
	return '0';
}

function cleanString(value: string): string {
	if (/^\'/.test(value) && /\'$/.test(value)) {
		return value.replace(/^\'/, '').replace(/\'$/, '')
	}
	return value;
}

export interface ParsedVariable {
	name: string,
	value: string,
	type: string,
	variablesReference: number | string,
}

export interface ParsedVariableScope {
	[id: string]: ParsedVariable[]
}

function createVariable(key: string, val: string): ParsedVariable {
	const name: string = cleanString(key);
	const value: string = cleanString(val);
	return {
		name,
		value,
		type: variableType(val),
		variablesReference: variableReference(value)
	};
}

interface VariableSearchResult {
	variable: ParsedVariable,
	parentName: string | number,
}

function findVariableReference(variables: ParsedVariableScope, variablesReference: string): VariableSearchResult | null {
	const variableScopes = Object.keys(variables);
	let parentName = 0;
	let variable: ParsedVariable | null = null;
	for (let i = 0; i < variableScopes.length; i++) {
		const parentName = variableScopes[i];
		const scope = variables[parentName];
		for (let b = 0; b < scope.length; b++) {
			variable = scope[b];
			// Check if we found the needle
			if (variable.variablesReference === variablesReference) {
				return {
					variable,
					parentName,
				}
			}
		}
	}
	return null;
}

const topScope = /global_0|local_0|closure_0/;

export function resolveVariable(name, variablesReference, variables) {
	// Resolve variables
	let limit = 0;
	let id = variablesReference;
	let key = name;
	const result = [];

	while (limit < 50 && !topScope.test(id)) {
		const parent = findVariableReference(variables, id);
		if (!parent) {
			throw new Error(`Cannot find variable "${id}"`);
		}
		if (parent.variable.type == 'array') {
			result.unshift(`[${key}]`);
		} else if (parent.variable.type == 'object') {
			result.unshift(`{${key}}`);
		} else {
			throw new Error('This dosnt look right');
		}

		id = parent.parentName;
		key = parent.variable.name;

		limit++;
	}

	result.unshift(key);

	return result.join('->');
}

/**
 * Fixes faulty variable data, an issue on windows
 *
 * Eg.: These lines are symptoms off an issue
 * '      1  '
 * '   \'list\' => '
 * '$obj = '
 */
function fixFaultyData(data: string[]): string[] {
	const result: string[] = [];
	let merge = '';
	data.forEach(line => {
		if (/=>? $/.test(line) || /([0-9]+)  $/.test(line)) {
			merge = line;
		} else {
			result.push(merge + line);
			merge = '';
		}
	});
	return result;
}

export default function(data: string[], scopeName: string = '0'): ParsedVariableScope {
	const result = {};
	const context: string[] = [scopeName];
	let lastReference = scopeName;
	// console.log('-----> SCOPE', scopeName);
	fixFaultyData(data).forEach(line => {
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

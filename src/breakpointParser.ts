import * as RX from "./regExp";

export const breakpointParser = (lines: string[]) => {
	const breakpoints = {};
	let currentFile = 'unknown';
	lines.forEach(line => {
		if (RX.breakPoint.condition.test(line)) {
			// Not relevant
		} else if (RX.breakPoint.ln.test(line)) {
			const lnX = line.match(RX.breakPoint.ln);
			if (breakpoints[currentFile] && lnX) {
				const ln = +lnX[1];
				if (lnX[1] === `${ln}`) {
					breakpoints[currentFile].push(ln);
				}
			}
		} else if (RX.breakPoint.filename.test(line)) {
			currentFile = line.replace(/:$/, '');
			if (typeof breakpoints[currentFile] === 'undefined') {
				breakpoints[currentFile] = [];
			}
		}
	});
	return breakpoints;
};
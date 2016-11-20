import assert = require('assert');

export default {
	throws(p, expected?) {
		return new Promise((resolve, reject) => {
			p.then(() => reject(new assert.AssertionError({ message: 'Missing expected exception..' }))).catch(res => resolve(res));
		});
	}
};


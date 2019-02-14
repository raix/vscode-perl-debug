import * as testRunner from 'vscode/lib/testrunner';

testRunner.configure({
    ui: 'bdd',
    useColors: true,
    timeout: 2000
});

module.exports = testRunner;

# VS Code Perl Debug [![Build Status](https://travis-ci.org/raix/vscode-perl-debug.svg?branch=master)](https://travis-ci.org/raix/vscode-perl-debug) [![Build status](https://ci.appveyor.com/api/projects/status/rtt7e5fq99vw6857/branch/master)](https://ci.appveyor.com/project/raix/vscode-perl-debug/branch/master)

A debugger for perl in vs code.

![Perl Debug](images/vscode-perl-debugger.gif)

### Features
* Breakpoints *(continue, step over, step in, step out)*
* Stacktrace
* Variable inspection *(support for objects, arrays, strings, numbers and boolean)*
* Variable watching *(for now we don't create actual watch breakpoints - figuring out how to maintain t)*
* Setting new values of variables *(works inside of arrays and objects too)*
* Debug console for writing expressions *(write perl expressions in the debug console)*
* Variable values on hover in code

### Settings

* `exec` Can be set to a specific perl binary *defaults to "perl"*
* `execArgs` Arguments that is passed to the binary perl executable
* `inc` Can be an array of strings / include paths
* `args` Can be an array of strings / program arguments

### Note

You might have to install `PadWalker` for variable inspection on windows *(and some linux distributions?)*

### Stability

Tests matrix running between os and perl versions:

* OSX - perl 5.22
* OSX - perl 5.20
* OSX - perl 5.18
* OSX - perl 5.16
* OSX - perl 5.14
* Linux - perl 5.22
* Linux - perl 5.20
* Linux - perl 5.18
* Linux - perl 5.16
* Linux - perl 5.14
* Windows 64bit - Strawberry perl v5.20.1.1
* Windows 64bit - Activeperl v5.24.1.2402

Known issues on windows:

* "Restart" - `inhibit_exit` is not respected and will cause the debugger to stop
* Variable inspection unstable - it's due to output inconsistency from the perl debugger

### Todo

* Watching variables doesn't create actual expression watchers yet - need more api for actually maintaining the list of expressions to watch. I might be able to do a workaround for now.
* Variable values on hover doesn't work all the time due to the lack of info, eg. `$obj->{ownObj}->{ownFoo}` hovering over `$obj` will work fine - but the children are not parsed correctly - to solve this we might need to parse the line of code.
* Function breakpoints not working / added - need to figure out if possible

### Credits

Credits goes to Microsoft for making an awesome editor and a nice getting started mock debugger: [https://github.com/Microsoft/vscode-mock-debug.git](https://github.com/Microsoft/vscode-mock-debug.git)


Kind regards

Morten

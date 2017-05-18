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
* `env` Used for setting environment variables when debugging, `PATH` and `PERL5LIB` default to system unless overwritten
* `trace` Boolean value to enable Debug Adapter Logging in `perl-debug.log` file

### Note

You might have to install `PadWalker` for variable inspection on windows *(and some linux distributions?)*

Also note that this extension now brings version 1.51 of `perl5db.pl` - this can be overwritten
by setting the environment variable `PERL5DB`.

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
* Windows 64bit - Strawberry perl 5.24.1
* Windows 64bit - Strawberry perl 5.22.3
* Windows 64bit - Strawberry perl 5.20.3
* Windows 64bit - Strawberry perl 5.18.4
* Windows 64bit - Strawberry perl 5.16.3
* Windows 64bit - Activeperl 5.24.1.2402

Known issues on windows:

* "Restart" - `inhibit_exit` is not respected and will cause the debugger to stop
* Variable inspection unstable - it's due to output inconsistency from the perl debugger

### Todo

* Watching variables doesn't create actual expression watchers yet - need more api for actually maintaining the list of expressions to watch. I might be able to do a workaround for now.
* Variable values on hover doesn't work all the time due to the lack of info, eg. `$obj->{ownObj}->{ownFoo}` hovering over `$obj` will work fine - but the children are not parsed correctly - to solve this we might need to parse the line of code.
* Function breakpoints not working / added - need to figure out if possible

### Credits

Credits goes to Microsoft for making an awesome editor and a nice getting started mock debugger: [https://github.com/Microsoft/vscode-mock-debug.git](https://github.com/Microsoft/vscode-mock-debug.git)


### Reporting issues and feature requests

I don't care about stars, but for everybodys sake:
Please use github for tracking issues and feature requests, thanks!

I do take pull requests for both documentation and code improvements!

Please be aware that this plugin depends on the OS/vs code/perl distribution/perl5db.pl
and none of these are perfect/consistent dependencies, therefor hard to track down.
*Why I've added a fairly broad test matrix across os/perl distributions*

Please keep in mind that I'm an ES developer, I don't know all
the corners of perl - so any help is appriciated.

Kind regards

Morten

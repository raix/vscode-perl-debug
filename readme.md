# VS Code Perl Debug [![Build Status](https://travis-ci.org/raix/vscode-perl-debug.svg?branch=master)](https://travis-ci.org/raix/vscode-perl-debug)

A minimalistic debugger for perl in vs code.

![Perl Debug](images/vscode-perl-debugger.gif)

### Features
* Breakpoints *(continue, step over, step in, step out)*
* Stacktrace
* Variable inspection *(support for objects, arrays, strings, numbers and boolean)*
* Variable watching *(for now we don't create actual watch breakpoints - figuring out how to maintain t)*
* Setting new values of variables *(works inside of arrays and objects too)*
* Debug console for writing expressions *(write perl expressions in the debug console)*
* Variable values on hover in code

Notes:
* Watching variables doesn't create actual expression watchers yet - need more api for actually maintaining the list of expressions to watch. I might be able to do a workaround for now.
* Variable values on hover doesn't work all the time due to the lack of info, eg. `$obj->{ownObj}->{ownFoo}` hovering over `$obj` will work fine - but the children are not parsed correctly - to solve this we might need to parse the line of code.
* Function breakpoints not working / added - need to figure out if possible

### Settings

* `exec` Can be set to a specific perl binary *defaults to "perl"*
* `inc` Can be an array of strings / include paths

### Credits

Credits goes to Microsoft for making an awesome editor and a nice getting started mock debugger: [https://github.com/Microsoft/vscode-mock-debug.git](https://github.com/Microsoft/vscode-mock-debug.git)

### Disclaimer

I'm in no way a perl expert - if you find bugs in the vs / perl debugger integration or want to contribute with code please don't hesitate.

It's not yet full featured,

Todo:
* settings
* battle test
* autocomplete?
* syntax check?

Kind regards

Morten

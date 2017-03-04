# Release Notes:

## 0.1.8
* Use "relativeFile" instead of "AskForProgram"
* Add changelog *(already found on [Releases](https://github.com/raix/vscode-perl-debug/releases))*

## 0.1.7
* Add the option "args" in the settings, this enables you to set program arguments for the program being debugged

## 0.1.6
* Added support for PERL5LIB environment variable

## 0.1.5
At times the windows perl debugger outputs inconsistent newlines when printing variables.
This release fixes faulty variable data and adds tests for variables back in for windows.

## 0.1.4
* variable scope fix for differences on linux
* test setup for windows

## 0.1.3
* Fix order of debugger arguments for include to work

## 0.1.2
* Added ability to set include directories in the launch config
* Added the ability to set a specific path to the perl executable
* Run the debugger with shell enabled - hope this will solve [#1](https://github.com/raix/vscode-perl-debug/issues/1)

## 0.1.1
* Step in
* Step out
* Set variable from inspector
* Watch variables and expressions
* Initial hover added
* Failed to implement function breakpoints (disabled for now)


## 0.0.1
* Initial version
* Breakpoints working
* Stacktrace
* Variable inspection
* Continue
* Step
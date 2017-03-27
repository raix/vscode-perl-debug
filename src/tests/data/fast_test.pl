#!/bin/perl

use Module;

print "Testing\n";
my $foo = "foo";

for my $i (0..5) {
    print "pre test..\n";
    Module::test();
    print "$i\n"
}

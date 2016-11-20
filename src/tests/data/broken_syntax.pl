#!/bin/perl

use Module;

print "Testing\n";
my $foo = "foo";
broken...
for my $i (0..60) {
    print "pre test..\n";
    test();
    sleep(1);
    print "$i sec\n"
}

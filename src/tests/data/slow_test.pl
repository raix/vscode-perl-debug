#!/bin/perl

use FindBin;
use lib "$FindBin::Bin";
use Module;

print "Testing\n";
my $foo = "foo";

for my $i (0..5) {
    print "pre test..\n";
    Module::test();
    sleep(0.01);
    print "$i sec\n"
}

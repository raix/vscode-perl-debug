#!/bin/perl

use FindBin;
use lib "$FindBin::Bin";
use Module;
use lib::Module2;

print "Testing\n";
my $foo = "foo";

for my $i (0..5) {
    print "pre test..\n";
    Module::test();
    sleep(1);
    print "$i sec\n"
}

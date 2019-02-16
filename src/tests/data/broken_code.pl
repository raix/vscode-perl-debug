#!/bin/perl

use FindBin;
use lib "$FindBin::Bin";
use Module;

print "Testing\n";
my $foo = "foo";

for my $i (0..60) {
    print "pre test..\n";
	functionNotFound();
    sleep(1);
    print "$i sec\n"
}

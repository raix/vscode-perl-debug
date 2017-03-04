#!/bin/perl

print "$#ARGV\n";

foreach $argnum (0 .. $#ARGV) {
    print "$ARGV[$argnum]\n";
}

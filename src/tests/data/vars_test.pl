#!/usr/bin/env perl
package Local::Package;
use strict;
use warnings;

our $PKG_OUR = "our Local::Package PKG_OUR";
my $PKG_MY = "my Local::Package PKG_MY";

sub outer_sub {
	my $outer_my = "outer_my";
	inner_sub("argument to inner_sub");
}

sub inner_sub {
	my ($arg) = @_;
	local $/ = "\x{20ac}";
	return $arg;
}

package main;
use strict;
use warnings;

my $main_my = "main_my";
my %hash = ("\%hash_key" => "\%hash_value");
my $hash_ref = {
	"hash_ref_key" => "hash_ref_value"
};

my $array_ref = [1..9];

my $string = "string";

my $ref_to_ref_to_string = \(\("ref_to_ref_to_string"));

Local::Package::outer_sub();

exit 0;

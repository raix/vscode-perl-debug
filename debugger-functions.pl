package DB;

#####################################################################
# Copyright (c) 2019 Bjoern Hoehrmann <bjoern@hoehrmann.de>. Licensed
# under the same terms as https://github.com/raix/vscode-perl-debug/
#####################################################################

#####################################################################
# Since `perl5db.pl` is intended for interactive use by human users,
# it can be difficult to extract information through the commands it
# provides. This module provides some helper functions to work around
# such problems on a best-effort basis. Additions very welcome.
#####################################################################

#####################################################################
# FIXME: All the functions defined here are only for the extension.
# Like `perl5db.pl` does for its functions, the debugger should be
# essentially disabled while executing them. For instance, when users
# set `w $DB::package` manually in the debugger, or function break-
# points on these functions, that should not cause the debugger to
# stop inside our functions. To the extent possible. Perhaps we could
# do something akin to `local($DB::trace, $DB::single);` towards the
# desired effect?
#####################################################################

#####################################################################
# FIXME: As of 2019-03 this completely ignores overloaded objects. In
# part as a feature, since some object have impractical overloads,
# for instance, `Graph.pm` has a stringify overload that essentially
# dumps the whole graph which can be very large; and it is not clear
# where and how it would make sense to consider overloads.
#####################################################################

BEGIN {

  # Try to load various modules we want to use when available. When
  # they are not available or fail to load, the rest of the code in
  # general tries to work around their absence.

  eval "require Scalar::Util";  # core since v5.7.3
  eval "require Sys::Hostname"; # core since v5
  eval "require Sub::Identify"; # not in core as of 5.28.1
  eval "require PadWalker";     # not in core as of 5.28.1

};

# Package variable to indicate the code here has already been loaded,
# so it is not loaded again when a process is forked (is this really
# needed, or does Perl notice that through %INC or somesuch?)
$Devel::vscode::DEBUGGER_FUNCTIONS = 1;

#####################################################################
# JSON encoding functions.
#####################################################################

sub Devel::vscode::_json_encode_string {

  my ($s) = @_;

  return 'null' unless defined $s;

  $s =~ s/(["\\\x00-\x1F\x80-\xff])/
    sprintf "\\u%04x", ord($1)
  /ge;

  return "\"$s\"";
}

sub Devel::vscode::_json_encode_array {

  my ($r) = @_;

  return '[' . join(',', map {
    ref($_)
      ? Devel::vscode::_json_encode_array($_)
      : Devel::vscode::_json_encode_string($_)
  } @$r) . ']'

}

#####################################################################
# Sorting functions.
#####################################################################

sub Devel::vscode::_sort_without_sigil {

  # It probably makes sense to put %INC and @INC next to one another,
  # so this function allows sorting ignoring the sigil. It should not
  # be used when sorting keys in hashes, sigils are meaningless there.

  return sort {

    my ($k1, $k2) = map {

      /^[\%\$\@\&]?(.*)/s;
      $1

    } map {

      defined($_) ? $_ : ''

    } $a, $b;

    $k1 cmp $k2;

  } @_;

}

#####################################################################
# Formatting functions.
#####################################################################

sub Devel::vscode::_format_refval {

  my ($r) = @_;

  return unless ref $r;

  if (defined &Scalar::Util::reftype) {

    if (
      'CODE' eq Scalar::Util::reftype($r)
      and
      defined &Sub::Identify::sub_fullname
    ) {
      return sprintf "\\&%s", Sub::Identify::sub_fullname($r);
    }

    # FOO(0xDEADBEEF) or Foo::Bar(0xDEADBEEF)
    return sprintf "%s(0x%08x)",
      Scalar::Util::blessed($r) ?
      Scalar::Util::blessed($r) :
      Scalar::Util::reftype($r),
      Scalar::Util::refaddr($r);

  } else {

    return "$r";

  }

}

sub Devel::vscode::_truncate {

  my ($s) = @_;
  my $max_len = 1024;
  my $mark = '[...]';
  return unless defined $s;
  return $s if length $s < $max_len;
  return substr($s, 0, $max_len - length $mark) . $mark;
}

sub Devel::vscode::_escape_double {

  my ($s) = @_;

  return 'undef' unless defined $s;

  # TODO(bh): This could produce prettier strings, like using `\t`
  # instead of `\x09`, but it should do for now.

  # Delimiter and characters that might cause interpolation
  $s =~ s/([\\\"\$\@\%])/\\$1/g;

  # C0 controls and non-ascii < U+0100
  $s =~ s/([\0-\x1f\x80-\xFF])/sprintf("\\x%02x",ord($1))/ge;

  # rest of non-ascii
  $s =~ s/([\x{100}-\x{10ffff}])/sprintf("\\x{%04x}",ord($1))/ge;

  return "\"$s\"";
}

sub Devel::vscode::_format_scalar {

  my ($s) = @_;

  if (
    defined(&Scalar::Util::looks_like_number($s))
    and
    Scalar::Util::looks_like_number($s)
  ) {
    return $s;
  } else {
    return Devel::vscode::_truncate(
      Devel::vscode::_escape_double($s)
    );
  }

}

#####################################################################
# Find details to symbols.
#####################################################################

sub Devel::vscode::_count_named_children {
  my ($ref) = @_;

  my $reftype = Scalar::Util::reftype($ref);

  return scalar( keys %$ref ) if $reftype eq 'HASH';
  return 1 if $reftype eq 'REF';
  return 1 if $reftype eq 'SCALAR';
  return;

}

sub Devel::vscode::_count_indexed_children {
  my ($ref) = @_;

  my $reftype = Scalar::Util::reftype($ref);

  return scalar( @$ref ) if $reftype eq 'ARRAY';
  return;

}

sub Devel::vscode::_hash_for_package {

  my ($package) = @_;
  my %h;

  my $p = $package eq 'main' ? "::" : "${package}::";

  for (sort grep { not /::/ and not /^_</ } keys %{$p}) {

    my $n = $_;
    $n =~ s/([\x00-\x1F])/ '^' . chr(ord($1) + 64)/eg;

    local(*_h) = *{ $p.$_ };

    if (defined ${ *_h }) {
      $h{"\$$n"} = \(${ *_h });
    }

    if (defined *_h{ARRAY}) {
      $h{"\@$n"} = \@{ *_h };
    }

    if (defined *_h{HASH}) {
      $h{"\%$n"} = \%{ *_h };
    }

    if (defined *_h{IO}) {
      $h{"$n"} = \*{ *_h };
    }

  }

  return \%h;

}

sub Devel::vscode::_h_to_vars {

  local ($ref, $n) = @_;
  local $@;

  # FIXME: does not handle missing Scalar::Util::reftype gracefully

  my $reftype = Scalar::Util::reftype($ref);

  if (!$reftype) {

    return [ $n, Devel::vscode::_format_scalar( $ref ), undef, undef ];

  } elsif ('SCALAR' eq $reftype) {

    return [ $n, Devel::vscode::_format_scalar( $$ref ), undef, undef ];

  } elsif ('REF' eq $reftype) {

    return [
      $n,
      Devel::vscode::_format_refval( $$ref ),
      undef,
      Devel::vscode::_count_named_children($$ref)
    ];

  } elsif ('ARRAY' eq $reftype ) {

    return [$n, undef, undef, scalar(@$ref)];

  } elsif ('HASH' eq $reftype ) {

    return [$n, undef, scalar(keys %$ref)];

  } elsif ('IO' eq $reftype ) {

    # eval { "fileno " . fileno(*_h) }
    return [$n, undef, undef, undef ];

  } elsif ('CODE' eq $reftype) {

    return [
      $n,
      Devel::vscode::_format_refval( $ref ),
      undef,
      undef
    ];

  }

  return;

}

#####################################################################
# Package symbols.
#####################################################################

sub Devel::vscode::_package_vars {

  my ($package) = @_;

  my $h = Devel::vscode::_hash_for_package($package);

  my @r;

  for my $n (Devel::vscode::_sort_without_sigil(keys %$h)) {
    my ($sigil) = $n =~ /^([\$\%\@\&])/;
    push @r, map {
      my @x = @$_;
      $x[4] = Scalar::Util::reftype($h->{$n}) eq 'REF' ? $n : '\\' . $n;
      \@x
    } Devel::vscode::_h_to_vars($h->{$n}, $n);
  }

  return \@r;
}


#####################################################################
# Lexical (my, our, state) symbols.
#####################################################################

sub Devel::vscode::_lexical_vars {

  my ($level) = @_;

  return [[
    'padwalker_missing', '"cpanm PadWalker"'
  ]] unless defined &PadWalker::peek_my;

  # Core module missing?
  return [[
    'scalar_util_missing', '"cpanm Scalar::Util"'
  ]] unless defined &Scalar::Util::reftype;

  # NOTE(bh): Like the `y` command in `perl5db.pl`, this only offers
  # `my` variables and not `our` variables.

  my $h = PadWalker::peek_my($level);
  my @r;

  for my $n (Devel::vscode::_sort_without_sigil(keys %$h)) {
    push @r, map {
      my @x = @$_;

      my $reftype = Scalar::Util::reftype($h->{$n});

      if (
        $reftype eq 'REF'
        and
        Scalar::Util::reftype(${ $h->{$n} }) =~ /^(?:ARRAY|HASH)$/
      ) {
        $x[4] = sprintf "\${ PadWalker::peek_my(%u)->{%s} }",
          $level - 2, Devel::vscode::_escape_double($n);
      } else {
        $x[4] = sprintf "PadWalker::peek_my(%u)->{%s}",
          $level - 2, Devel::vscode::_escape_double($n);
      }

      \@x
    } Devel::vscode::_h_to_vars($h->{$n}, $n);
  }

  return \@r;
}

#####################################################################
# Children (elements in arrays, key-value pairs in hashes).
#####################################################################

sub Devel::vscode::_get_element_symbols_json {

  my ($h) = @_;

  my $has_reftype = defined &Scalar::Util::reftype;

  if ($has_reftype and 'HASH' eq Scalar::Util::reftype($h)) {

    return Devel::vscode::_json_encode_array(
      Devel::vscode::_hashelems($h)
    );

  } elsif ($has_reftype and 'ARRAY' eq Scalar::Util::reftype($h)) {

    return Devel::vscode::_json_encode_array(
      Devel::vscode::_arrayelems($h)
    );

  } elsif ($has_reftype and 'REF' eq Scalar::Util::reftype($h)) {

    my $deref = Devel::vscode::_h_to_vars(
      $$h,
      Devel::vscode::_format_refval($$h)
    );

    $deref->[4] = '->$*';

    return Devel::vscode::_json_encode_array([$deref]);

  } else {

    # ...

  }

  return Devel::vscode::_json_encode_array([]);

}

sub Devel::vscode::_hashelems {

  my ($h) = @_;

  my @r = map {
    Devel::vscode::_h_to_vars($h->{$_}, $_)
  } sort keys %$h;

  for (@r) {
    $_->[4] = sprintf(
      '->{%s}',
      Devel::vscode::_escape_double($_->[0])
    );
  }

  return \@r;
}

sub Devel::vscode::_arrayelems {

  my ($arrayref) = @_;

  my @r = map {
    Devel::vscode::_h_to_vars($arrayref->[$_], $_)
  } 0 .. scalar(@$arrayref) - 1;

  for (@r) {
    $_->[4] = sprintf '->[%u]', $_->[1];
  }

  return \@r;
}

#####################################################################
# Variable retrieval.
#####################################################################

sub Devel::vscode::_get_lexical_symbols_json {

  my ($level) = @_;

  my $return = Devel::vscode::_json_encode_array(
    Devel::vscode::_lexical_vars($level + 4),
  );

  return $return;

}

sub Devel::vscode::_get_package_symbols_json {

  my ($pkg) = @_;

  return Devel::vscode::_json_encode_array(
    Devel::vscode::_package_vars($pkg),
  );

}

#####################################################################
# Variable setting.
#####################################################################

sub Devel::vscode::_set_variable {

  my ($lhs, $elem, $rhs) = @_;

  if (defined &Scalar::Util::reftype) {
    if (Scalar::Util::reftype($lhs) eq 'HASH') {
      return Devel::vscode::_format_scalar($$lhs->{$elem} = $rhs);
    } elsif (Scalar::Util::reftype($lhs) eq 'ARRAY') {
      return Devel::vscode::_format_scalar($$lhs->[$elem] = $rhs);
    } else {
      return Devel::vscode::_format_scalar($$lhs = $rhs);
    }
  }

  return;
}

#####################################################################
# Source code retrieval.
#####################################################################

sub Devel::vscode::_get_unreported_sources_json {

  # NOTE: This maintains a cache of already reported sources. It sets
  # the cache values to the current process identifier to account for
  # forked children. They inherit a copy of the cache, but have their
  # own connection to the debug extension, where previously reported
  # sources would count as already-reported otherwise.

  return Devel::vscode::_json_encode_array([
    grep {
      my $old = $Devel::vscode::_reported_sources{$_};
      $Devel::vscode::_reported_sources{$_} = $$;
      not defined $old or $old ne $$
    } grep { /^_<[^(]/ } keys %main::
  ]);

}

sub Devel::vscode::_get_source_code_json {

  my ($path) = @_;

  # Perl stores file source code in `@{main::_<example.pl}` arrays.
  # Array index zero can hold injected code. Perl for instances puts
  # `BEGIN { require "perl5db.pl" }` there and we do not want to see
  # that in the source code, so the first line is always omitted.

  my @lines = @{"main::_<$path"};
  shift @lines;

  return Devel::vscode::_json_encode_array(\@lines);

}

#####################################################################
# Stack frames.
#####################################################################

sub Devel::vscode::_get_callers_json {

  my ($level, $num) = @_;
  my @result;

  $level += 3;

  $num = 2**31 unless defined $num;

  while (1) {
    my @frame = caller($level++);

    # @DB::args would be available here.

    last unless @frame;

    # Cannot serialise hashref at the moment
    $frame[10] = undef;

    # Keep it brief
    @frame = @frame[0..3];

    push @result, \@frame;
    last if @result >= $num;
  }

  return Devel::vscode::_json_encode_array(\@result);

}

#####################################################################
# Wrapper for DB::postponed
#####################################################################

*DB::postponed = sub {

  # As perl `perldebguts`, "After each required file is compiled,
  # but before it is executed, DB::postponed(*{"_<$filename"}) is
  # called if the subroutine DB::postponed exists." and "After
  # each subroutine subname is compiled, the existence of
  # $DB::postponed{subname} is checked. If this key exists,
  # DB::postponed(subname) is called if the DB::postponed
  # subroutine also exists."
  #
  # Overriding the function with a thin wrapper like this would
  # give us a chance to report any newly loaded source directly
  # instead of repeatedly polling for it, which could be used to
  # make breakpoints more reliable. Same probably for function
  # breakpoints if they are registered as explained above.
  #
  # Note that when a Perl process is `fork`ed, we may already have
  # wrapped the original function and must avoid doing it again.
  # This is not actually used at the moment. We cannot usefully
  # break into the debugger here, since there is no good way to
  # resume exactly as the user originally intended. There would
  # have to be a way to process such messages asynchronously as
  # they arrive.

  my ($old_postponed) = @_;

  $Devel::vscode::_overrode_postponed = 1;

  #

  return sub {
    if ('GLOB' eq ref(\$_[0]) and $_[0] =~ /<(.*)\s*$/s) {
      print { $DB::OUT } "vscode: new loaded source $1\n";
    } else {
      print { $DB::OUT } "vscode: new subroutine $_[0]\n";
    }
    &{$old_postponed};
  };

}->(\&DB::postponed) unless $Devel::vscode::_overrode_postponed;

#####################################################################
# ...
#####################################################################

1;


__END__

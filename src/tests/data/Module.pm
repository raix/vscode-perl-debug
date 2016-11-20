package Module;

sub test() {
    my $bar = "bar";
    my $i = 12;
    my @list1 = ('a', '\'b', 'c');
    my @list2 = (1, 2, 3);
    my @list3 = (@list1, @list2);
    my $hello = {
        foo => 'bar',
        bar => 12,
        really => true,
    };
    my $obj = {
        foo => 'bar',
        bar => $hello,
        list => \@list1,
        ownlist => (7, 8, 9),
        ownObj => {
            ownFoo => 'own?'
        }
    };
    print "Hello module\n";
};

1;
#!/usr/bin/perl

use strict;
use TryCatch;
use File::Path;
use File::Copy;
use File::Copy::Recursive qw(fcopy rcopy dircopy);
use Archive::Zip qw( :ERROR_CODES :CONSTANTS );

sub END {
    print STDERR "Ok";
    sleep(1);
}

my $closureCompiler = './closureJS/closure-compiler-v20191027.jar --warning_level=QUIET --language_in=ECMASCRIPT6';
my $build_dir = './build_dir/';
my $target_dir = './target_dir';
my @files = ('lib', 'modules', 'img', 'fancy-settings', '_locales');

try {


    #rmdir $build_dir or print SYSERR $!;
    rmtree( $build_dir, 1) or print SYSERR $!;
    rmtree( $build_dir, 1) or print SYSERR $!;

    mkdir $build_dir or die $!;

    foreach(@files)
    {
        dircopy("./$_","./$build_dir/$_") or die $!;
    }

    my @files = glob("./*.*");

    for my $file (@files) {
        if($file ne './build.pl'){
            print STDERR $file."\n";
            copy("./$file", $build_dir) or die "Copy failed: $!";
        }
    }

	print STDERR "Obfuscete: background.js, park.js, popup.js, utils.js...";
    `java -jar $closureCompiler --js $build_dir/background.js --js_output_file $build_dir/background.js`;
	`java -jar $closureCompiler --js $build_dir/park.js --js_output_file $build_dir/park.js`;
	`java -jar $closureCompiler --js $build_dir/popup.js --js_output_file $build_dir/popup.js`;
	`java -jar $closureCompiler --js $build_dir/utils.js --js_output_file $build_dir/utils.js`;
	print STDERR "Ok\n";

	# Just test for JS error no really used obfuscated files.

	my @files = glob("$build_dir/modules/*.js");
	#push (@files, glob("$build_dir/modules/*.js"));
    for my $file (@files) {
        if($file ne './build.pl'){
            print "Obfuscate modules $build_dir/$file...";
            `java -jar $closureCompiler --js $file --js_output_file $file`;
            print "OK\n";
        }
    }

	#print STDERR "Check all JS syntax...\n";
    #my $command = "java -jar ".$closureCompiler." --js ".$build_dir."modules/*.js --js ".$build_dir."*.js --js_output_file ./tmp/dummy.js";
    #print STDERR $command;
    #`$command`;
	#print STDERR "Ok\n";


    mkdir $target_dir or print SYSERR $!;

    my $zip = Archive::Zip->new() or die $!;
    my $dir_member = $zip->addTree( $build_dir ) or print SYSERR $!;
    my $status = $zip->writeToFileNamed( "$target_dir/AutomaticTabsCleanerSuspender.zip" ) or print SYSERR $!;
}
catch ($err)
{
    print STDERR $err;
}

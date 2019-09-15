// Result of:
// perl -d slow_test.pl
// f Module.pm
// b 23
// c
// y 0

export const perl5_22_4 = `(
$bar = 'bar'
$hello = HASH(0x7fa39615edc8)
   'bar' => 12
   'foo' => 'bar'
   'really' => 'true'
$i = 12
$obj = HASH(0x7fa396148a80)
   8 => 9
   'bar' => HASH(0x7fa39615edc8)
      'bar' => 12
      'foo' => 'bar'
      'really' => 'true'
   'foo' => 'bar'
   'list' => ARRAY(0x7fa39615ed20)
      0  'a'
      1  '\'b'
      2  'c'
   'ownObj' => HASH(0x7fa396947d40)
      'ownFoo' => 'own?'
   'ownlist' => 7
@list1 = (
   0  'a'
   1  '\'b'
   2  'c'
)
@list2 = (
   0  1
   1  2
   2  3
)
@list3 = (
   0  'a'
   1  '\'b'
   2  'c'
   3  1
   4  2
	 5  3
)`.split("\n");

export const perl5_20_3 = `(
	'-' => HASH(0x7f8c5f01cb58)
		 't' => 'm'
		 'v' => '_handle_dash_command'
	'.' => HASH(0x7f8c5e13ec18)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0c7be0)
				-> &DB::_DB__handle_dot_command in 0
	'=' => HASH(0x7f8c5e11d138)
		 't' => 'm'
		 'v' => '_handle_equal_sign_command'
	'A' => HASH(0x7f8c5e973e10)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'B' => HASH(0x7f8c5e973f00)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'E' => HASH(0x7f8c5e973ff0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'H' => HASH(0x7f8c5e1293e0)
		 't' => 'm'
		 'v' => '_handle_H_command'
	'L' => HASH(0x7f8c5e9741d0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'M' => HASH(0x7f8c5e974248)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'O' => HASH(0x7f8c5e974338)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'R' => HASH(0x7f8c5e973b88)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0d2198)
				-> &DB::_DB__handle_restart_and_rerun_commands in 0
	'S' => HASH(0x7f8c5e129368)
		 't' => 'm'
		 'v' => '_handle_S_command'
	'T' => HASH(0x7f8c5e11d1c8)
		 't' => 'm'
		 'v' => '_handle_T_command'
	'V' => HASH(0x7f8c5e96ee88)
		 't' => 'm'
		 'v' => '_handle_V_command_and_X_command'
	'W' => HASH(0x7f8c5e9744a0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'X' => HASH(0x7f8c5e96e840)
		 't' => 'm'
		 'v' => '_handle_V_command_and_X_command'
	'a' => HASH(0x7f8c5e96f5c0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'b' => HASH(0x7f8c5e973e88)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'c' => HASH(0x7f8c5e108048)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0c8000)
				-> &DB::_DB__handle_c_command in 0
	'disable' => HASH(0x7f8c5e96f548)
		 't' => 'm'
		 'v' => '_handle_enable_disable_commands'
	'e' => HASH(0x7f8c5e973f78)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'enable' => HASH(0x7f8c5e96f2f0)
		 't' => 'm'
		 'v' => '_handle_enable_disable_commands'
	'f' => HASH(0x7f8c5e114e40)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0c7448)
				-> &DB::_DB__handle_f_command in 0
	'h' => HASH(0x7f8c5e974068)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'i' => HASH(0x7f8c5e9740e0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'l' => HASH(0x7f8c5e974158)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'm' => HASH(0x7f8c5e1080c0)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0d2918)
				-> &DB::_DB__handle_m_command in 0
	'n' => HASH(0x7f8c5e0ec118)
		 't' => 'm'
		 'v' => '_handle_n_command'
	'o' => HASH(0x7f8c5e9742c0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'p' => HASH(0x7f8c5e0f1310)
		 't' => 'm'
		 'v' => '_handle_p_command'
	'q' => HASH(0x7f8c5e95ebc0)
		 't' => 'm'
		 'v' => '_handle_q_command'
	'r' => HASH(0x7f8c5e95e710)
		 't' => 'm'
		 'v' => '_handle_r_command'
	'rerun' => HASH(0x7f8c5f1ef320)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0d2198)
				-> REUSED_ADDRESS
	's' => HASH(0x7f8c5e95e5a8)
		 't' => 'm'
		 'v' => '_handle_s_command'
	'save' => HASH(0x7f8c5e95e380)
		 't' => 'm'
		 'v' => '_handle_save_command'
	'source' => HASH(0x7f8c5e95e320)
		 't' => 'm'
		 'v' => '_handle_source_command'
	't' => HASH(0x7f8c5e95e290)
		 't' => 'm'
		 'v' => '_handle_t_command'
	'v' => HASH(0x7f8c5e9743b0)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'w' => HASH(0x7f8c5e974428)
		 't' => 'm'
		 'v' => '_handle_cmd_wrapper_commands'
	'x' => HASH(0x7f8c5e926d08)
		 't' => 'm'
		 'v' => '_handle_x_command'
	'y' => HASH(0x7f8c5e95e5f0)
		 't' => 's'
		 'v' => CODE(0x7f8c5e0c7aa8)
				-> &DB::_DB__handle_y_command in 0
)`.split("\n");
const perl5_18_4 = ``;
const perl5_16_3 = ``;
const perl5_14_4 = ``;

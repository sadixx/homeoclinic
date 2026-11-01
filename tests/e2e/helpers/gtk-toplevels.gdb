# gdb batch script (TEST-ONLY): print the attached GTK app's toplevel windows
# (type + title). Used by helpers/x11.ts gtkToplevels(); detaches on exit.
set pagination off
set $l = (void*)gtk_window_list_toplevels()
printf "GTK_TOPLEVELS=%d\n", (int)g_list_length($l)
set $i = 0
while $i < (int)g_list_length($l)
  set $w = (void*)g_list_nth_data($l, $i)
  printf "TOPLEVEL[%d] type=%s title=%s\n", $i, (char*)g_type_name(*(unsigned long*)(*(void**)$w)), (char*)gtk_window_get_title($w)
  set $i = $i + 1
end

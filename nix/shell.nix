# nix-shell: `totem-keybard` (the configurator) and `totem-overlay` (the desktop overlay), run
# by nixpkgs' Electron from the prebuilt files in ./app. Nothing is built.
{
  pkgs ? import <nixpkgs> { },
}:
let
  electron = "${pkgs.electron}/bin/electron --ozone-platform=x11 ${./app}";
in
pkgs.mkShell {
  packages = [
    (pkgs.writeShellScriptBin "totem-keybard" ''exec ${electron} --editor "$@"'')
    (pkgs.writeShellScriptBin "totem-overlay" ''exec ${electron} "$@"'')
  ];
}

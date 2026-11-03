# TOTEM keybard for a dendritic NixOS config: `totem-keybard` (the configurator) and
# `totem-overlay` (the desktop overlay), run by nixpkgs' Electron from the prebuilt files in
# ./app (main.js, preload.js, package.json, icons, totem-keybard.html). Nothing is built.
# Both also show up in the app launcher (desktop entries).
# Keyboard access comes from Vial's udev rule: services.udev.packages = [ pkgs.vial ];
{ self, inputs, ... }:
{
  flake.nixosModules.totem-keybard =
    { pkgs, ... }:
    let
      # through XWayland: Wayland doesn't let the overlay stay on top or place itself
      electron = "${pkgs.electron}/bin/electron --ozone-platform=x11 ${./app}";
      desktopEntry =
        name: desktopName: comment:
        pkgs.makeDesktopItem {
          inherit name desktopName comment;
          exec = name;
          icon = "${./app}/icon.png";
          categories = [ "Utility" ];
          startupWMClass = "totem-overlay"; # the app's windows, so the launcher groups them
        };
    in
    {
      environment.systemPackages = [
        (pkgs.writeShellScriptBin "totem-keybard" ''exec ${electron} --editor "$@"'')
        (pkgs.writeShellScriptBin "totem-overlay" ''exec ${electron} "$@"'')
        (desktopEntry "totem-keybard" "TOTEM keybard" "Remap your GEIST TOTEM keyboard")
        (desktopEntry "totem-overlay" "TOTEM Overlay" "Your TOTEM layout on top of every app, following the layer you're on")
      ];
    };
}

# totem-keybard as a package: the prebuilt app in ./app (main.js, preload.js, package.json, icons,
# totem-keybard.html), run by nixpkgs' Electron. Nothing is built. Two commands, each with a
# launcher entry: `totem-keybard` (the configurator) and `totem-overlay` (the desktop overlay).
# Keyboard access comes from Vial's udev rule: services.udev.packages = [ pkgs.vial ];
{
  lib,
  stdenvNoCC,
  electron,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
}:
let
  # Each app's windows have their own class (the configurator "totem-keybard", the overlay
  # "totem-overlay"), so desktop shells see two apps and launch each from its own entry.
  entry =
    name: desktopName: comment:
    makeDesktopItem {
      inherit name desktopName comment;
      exec = name;
      icon = "totem-keybard";
      categories = [ "Utility" ];
      startupWMClass = name;
    };
in
stdenvNoCC.mkDerivation {
  pname = "totem-keybard";
  version = (lib.importJSON ./app/package.json).version;
  src = ./app;

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
  ];

  # through XWayland: Wayland doesn't let the overlay stay on top or place itself
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/totem-keybard
    cp -r . $out/share/totem-keybard/
    install -Dm644 icon.png $out/share/icons/hicolor/256x256/apps/totem-keybard.png
    makeWrapper ${lib.getExe electron} $out/bin/totem-keybard \
      --add-flags "--ozone-platform=x11 $out/share/totem-keybard --editor"
    makeWrapper ${lib.getExe electron} $out/bin/totem-overlay \
      --add-flags "--ozone-platform=x11 $out/share/totem-keybard"
    runHook postInstall
  '';

  desktopItems = [
    (entry "totem-keybard" "TOTEM keybard" "Remap your GEIST TOTEM keyboard")
    (entry "totem-overlay" "TOTEM Overlay" "Your TOTEM layout on top of every app, following the layer you're on")
  ];

  meta = {
    description = "Unofficial configurator and desktop overlay for the GEIST TOTEM keyboard (Vial)";
    license = lib.licenses.gpl2Plus;
    platforms = lib.platforms.linux;
    mainProgram = "totem-keybard";
  };
}

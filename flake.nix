{
  description = "totem-keybard: unofficial configurator and desktop overlay for the GEIST TOTEM keyboard (prebuilt, run by nixpkgs' Electron)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # nix run github:<you>/totem-keybard            the configurator
      # nix run github:<you>/totem-keybard#overlay    the desktop overlay
      packages = forSystems (pkgs: rec {
        totem-keybard = pkgs.callPackage ./nix/package.nix { };
        default = totem-keybard;
      });

      apps = forSystems (
        pkgs:
        let
          pkg = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          app = bin: description: {
            type = "app";
            program = "${pkg}/bin/${bin}";
            meta = { inherit description; };
          };
        in
        {
          default = app "totem-keybard" "The TOTEM configurator";
          overlay = app "totem-overlay" "The TOTEM desktop overlay";
        }
      );

      # Both commands and their launcher entries, with the system's own nixpkgs (and its Electron).
      # Keyboard access: Vial's udev rule, services.udev.packages = [ pkgs.vial ];
      nixosModules.default =
        { pkgs, ... }:
        {
          environment.systemPackages = [ (pkgs.callPackage ./nix/package.nix { }) ];
        };
      nixosModules.totem-keybard = self.nixosModules.default;

      overlays.default = final: _prev: { totem-keybard = final.callPackage ./nix/package.nix { }; };
    };
}

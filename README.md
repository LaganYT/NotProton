# NotProton

NotProton enables the Steam Play experience from Linux Steam in the macOS Steam client.

This is done by forcibly enabling the Steam Play functionality in macOS Steam (which is
present and inert) as well as by porting some components of Valve's Proton to macOS.

This tool is intended to be used with the stable Steam Client (version 1791918634) as well as the beta Steam Client (version 1792192922) paired with **CrossOver 26.3 or CrossOver [Preview](https://www.codeweavers.com/preview)
20261006 / 20260821 / 20261015**, with more supported versions to come.

**NTFS file systems/drivers are not currently supported.**

Supporting specifically CrossOver is a design goal of this project. Better support for modifying CrossOver (using custom builds of DXMT/patched D3DMetal/MacGameVideoFix) will come in a future update, but support for alternatives to CrossOver itself is not planned.

Both the FEX and the Rosetta versions are supported. I recommend using the FEX version of the 
Preview 20261006, as it includes both the FEX version as well as the Rosetta one. 

I further recommend going into Steam Settings - Compatibility and selecting the Rosetta version as your default compatibility tool. You can select FEX on a per game basis by right clicking a game in Steam, going into Properties - Compatibility and selecting FEX there.

If a game has a native macOS version as well as a Windows one, Steam will download the macOS version. To override this behavior, right click on the game, select Properties, select Compatibility. Enable 'Force the use of a specific Steam Play compatibility tool'. Select whichever version of CrossOver you want to do use. That will make Steam download the Windows version. Unchecking the 'Force the use...' box or selecting 'No Compatibility Tool' in the drop down list will revert to the macOS version of the game, with the specifics there varying based on your Steam version.

**Valve Anti-Cheat is not supported.** Proton itself does not support VAC in Valve titles; Valve ships native Linux ports instead. VAC titles will launch in Insecure Mode and will not allow matchmaking. 

**This project now has a brew cask.** For brew users, you can install via ``brew install --cask notprotonnot/notproton/notproton``

Please read NOTICE for license information.

Please open issue reports with any issues. PRs are welcome and encouraged.

## Launch a different executable

Use the original game's **Properties > General > Launch Options** in Steam. This
keeps the game's existing prefix, compatibility tool, and Steam identity.

1. Open **Properties > Installed Files > Browse** to find the executable.
2. Copy its full macOS path. In Finder, hold Option and choose **Copy as Pathname**.
3. Replace the Launch Options text with that path in straight double quotes. For
   example, to use Assassin's Creed's alternate executable:

   ```text
   "/Users/yourname/Library/Application Support/Steam/steamapps/common/Assassin's Creed/AssassinsCreed_Dx10.exe"
   ```

Put any arguments after the closing quote. Use the actual path on your Mac,
including its capitalization. Clear Launch Options to restore the normal launch.

Leave out `%command%` when replacing the executable this way. Putting a path
before `%command%` asks that program to run Steam's original command as a wrapper;
it does not simply select another game executable. Adding a non-Steam shortcut
also creates a separate Steam identity and normally a separate prefix.

### Batch files and Mod Engine 2

The existing Wine Steam shim sends `.bat` targets to Windows shell handling. A
batch file is a Windows script, so do not run it with macOS `/bin/sh`. Use its
quoted absolute path in the original game's Launch Options, just as for an `.exe`:

```text
"/Users/yourname/Games/ModEngine2/launchmod_eldenring.bat"
```

The working directory still comes from Steam; selecting a file does not change
it to that file's folder. Check scripts that use relative paths.
[Mod Engine 2's Elden Ring batch file](https://github.com/soulsmods/ModEngine2/blob/main/installer/dist/launchmod_eldenring.bat)
calls `.\modengine2_launcher.exe -t er -c .\config_eldenring.toml`, so those paths
must resolve from the working directory. The launcher can also be selected
directly, with its `-t er -c` arguments and a Windows path to the config file.

The alternate Assassin's Creed executable was confirmed in
[issue #17](https://github.com/NotProtonNot/NotProton/issues/17#issuecomment-6191449695).
Elden Ring with Mod Engine 2 has not been verified end to end. Selecting its
launcher does not establish that its injection or mods work under CrossOver.

There are many people who worked on similar ideas, similar projects. I did not base NotProton on their work, but I still want to 
give thanks to the people who came before me:

[Nat Brown](https://github.com/natbro) made [Kaon](https://github.com/natbro/kaon), which is similar in goals to NotProton.

mont127's [Neutron](https://github.com/mont127/Neutron) is also a similar idea, but implemented differently. 

[Gio](https://github.com/giodotblue) was working enabling Steam Play inside of Steam on macOS prior to the release of NotProton itself. 
I would have done things differently had I been aware of that. 

Thanks to everyone who has positively contributed to macOS gaming. 

Developer Notes:

As far as the source structure goes, the macOS app itself is located in the ```app``` folder. The core logic is in ```dylib```.
```lsteamclient``` is a macOS port of Valve's lsteamclient. ```steam-shim```is a port of Valve's
steam-helper from Proton 9.0. ntdll-patch patches the copy of CrossOver that the app
makes/places in the ```~/Library/Application Support/notproton/runners/``` folder so that
lsteamclient is loaded.

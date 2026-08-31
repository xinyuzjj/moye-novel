; 墨页 安装脚本 (Inno Setup 6)
; 用法：ISCC.exe installer.iss  （需先 node build.mjs 生成 dist\墨页\）
#define MyAppName "墨页"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "峻峻尼"
#define MyAppURL "https://github.com/xinyuzjj/moye-novel"
#define MyAppExeName "墨页-win_x64.exe"

[Setup]
; 固定 GUID 用于标识本应用，便于升级/卸载
AppId={{8F6A1B2C-3D4E-5F60-A9E0-E1F23C4B4D5E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
; 免 UAC：安装到当前用户 AppData\Programs
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename={#MyAppName}-setup
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "installer\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务"; Flags: unchecked

[Files]
Source: "dist\墨页\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "安装完成后启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

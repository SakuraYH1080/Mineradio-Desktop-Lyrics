const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function query(script, variables = {}) {
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Import-Module -Name (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')
` + script;
  return execFileSync(powershell, [
    '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...variables } }).trim();
}

function signatureOf(file) {
  return JSON.parse(query(`
$sig = Get-AuthenticodeSignature -LiteralPath $env:MINERADIO_SIGNING_FILE
[pscustomobject]@{
  status = $sig.Status.ToString()
  type = $sig.SignatureType.ToString()
  publisher = $sig.SignerCertificate.Subject
  issuer = $sig.SignerCertificate.Issuer
  thumbprint = $sig.SignerCertificate.Thumbprint
  timestamped = [bool]$sig.TimeStamperCertificate
} | ConvertTo-Json -Compress`, { MINERADIO_SIGNING_FILE: file }));
}

function verifySignature(file) {
  const signature = signatureOf(file);
  if (signature.status !== 'Valid' || signature.type !== 'Authenticode' ||
      !signature.timestamped || signature.publisher === signature.issuer) {
    throw Error(path.basename(file) + ' must have a trusted embedded Authenticode signature and timestamp (status: ' + signature.status + ').');
  }
  return signature;
}

function sdkSignTool() {
  return query(`
$onPath = Get-Command signtool.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($onPath) { $onPath.Source; return }
$kits = (Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots').KitsRoot10
Get-ChildItem -LiteralPath (Join-Path $kits 'bin') -Directory |
  Where-Object Name -Match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64\\signtool.exe' } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1`);
}

function certificateStore(thumbprint) {
  return query(`
foreach ($store in @('CurrentUser', 'LocalMachine')) {
  $item = Get-Item -LiteralPath "Cert:\\$store\\My\\$env:MINERADIO_SELECTED_CERT" -ErrorAction SilentlyContinue
  if ($item -and $item.HasPrivateKey -and $item.NotBefore -le (Get-Date) -and $item.NotAfter -gt (Get-Date) -and
      $item.Subject -ne $item.Issuer -and $item.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3') {
    $store
    break
  }
}`, { MINERADIO_SELECTED_CERT: thumbprint });
}

function createWindowsSigner() {
  const thumbprint = process.env.MINERADIO_SIGN_CERT_THUMBPRINT?.replace(/\s/g, '').toUpperCase();
  const dlib = process.env.MINERADIO_SIGN_DLIB;
  const profile = process.env.MINERADIO_SIGN_METADATA;
  if (!thumbprint && !dlib && !profile) {
    throw Error('No Windows signing identity configured. Set MINERADIO_SIGN_CERT_THUMBPRINT for a trusted certificate, or configure Artifact Signing.');
  }
  if (thumbprint && (dlib || profile)) throw Error('Choose one Windows signing provider for this build.');

  let selection;
  if (thumbprint) {
    if (!/^[A-F0-9]{40}$/.test(thumbprint)) throw Error('Invalid code-signing certificate thumbprint.');
    const store = certificateStore(thumbprint);
    if (!store) throw Error('The selected code-signing certificate is unavailable in CurrentUser\\My or LocalMachine\\My.');
    selection = [...(store === 'LocalMachine' ? ['/sm'] : []), '/s', 'My', '/sha1', thumbprint];
  } else {
    if (!dlib || !profile) throw Error('Artifact Signing requires both MINERADIO_SIGN_DLIB and MINERADIO_SIGN_METADATA.');
    selection = ['/dlib', fs.realpathSync(dlib), '/dmdf', fs.realpathSync(profile)];
  }

  const tool = process.env.MINERADIO_SIGNTOOL || sdkSignTool();
  if (!tool) throw Error('Windows SDK SignTool was not found. Set MINERADIO_SIGNTOOL to the path of signtool.exe.');
  const timestamp = process.env.MINERADIO_SIGN_TIMESTAMP_URL ||
    (thumbprint ? 'http://timestamp.digicert.com' : 'http://timestamp.acs.microsoft.com');
  const provider = thumbprint ? 'windows-certificate' : 'microsoft-artifact-signing';
  return {
    provider,
    sign(file) {
      execFileSync(tool, ['sign', '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256', ...selection, file],
        { stdio: 'inherit', windowsHide: true });
      const signature = verifySignature(file);
      if (thumbprint && signature.thumbprint !== thumbprint) {
        throw Error('The file was signed with a different certificate: ' + path.basename(file));
      }
      return signature;
    },
  };
}

module.exports = { createWindowsSigner, verifySignature };

@echo off
chcp 65001 >nul
title Lube - Gerar chave da ponte
powershell -NoProfile -Command "$b = New-Object byte[] 36; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b) -replace '\+','-' -replace '/','_') | Set-Clipboard"
if errorlevel 1 (
  echo Nao deu para gerar a chave. Nada foi copiado.
  pause
  exit /b 1
)
echo.
echo  Chave nova copiada (48 caracteres). Ela NAO aparece na tela.
echo.
echo  1. Na Vercel, no projeto da ponte do painel:
echo     Settings ^> Environment Variables ^> Add
echo     Key: PONTE_CHAVE   Value: Ctrl+V   Environment: Production   Sensitive: ligado
echo  2. Cole a mesma chave na mensagem particular para o dono do script
echo     (ele poe em Configuracoes do projeto ^> Propriedades do script ^> PONTE_CHAVE).
echo  3. Para o outro painel, rode este arquivo de novo: cada painel tem a sua chave.
echo.
echo  Pontes: sentinela-ponte-compras-matriz e sentinela-ponte-compras-rj
echo.
pause

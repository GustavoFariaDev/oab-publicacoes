# Registra a automacao no Agendador de Tarefas do Windows.
#
#   14:00  execucao principal
#   16:00  retry condicional (no-op so se o dia ja saiu por TODOS os canais,
#          com todas as fontes de pe e a contagem batendo — ver isDayComplete)
#   17:00  retry condicional
#
# Rode uma vez:  npm run register-task

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LinkPath   = 'D:\oab-pubs'

# Se o caminho do projeto tiver acento ou espaco, o Agendador de Tarefas
# quebra em silencio com mais frequencia do que deveria. Por isso a tarefa
# aponta para um junction em ASCII puro; o projeto continua morando onde esta.
if (-not (Test-Path $LinkPath)) {
    Write-Host "Criando junction $LinkPath -> $ProjectDir"
    New-Item -ItemType Junction -Path $LinkPath -Target $ProjectDir | Out-Null
} else {
    Write-Host "Junction $LinkPath ja existe."
}

$NodeExe = (Get-Command node).Source
Write-Host "Node: $NodeExe"

# -WakeToRun: se a maquina estiver dormindo (S3), ela acorda sozinha na hora da
# tarefa. Existe para o PC poder passar a noite dormindo em vez de ligado 24h,
# sem depender de RTC Alarm na BIOS. Dormindo a sessao do Windows NAO fecha, e
# e disso que o pipeline depende: o cookie do portal e a sessao do WhatsApp
# continuam de pe, entao as 14h nao ha desafio da Cloudflare para clicar.
#
# Duas coisas que isto NAO faz:
#   - nao alcanca a maquina DESLIGADA (S5); ai so RTC Alarm na BIOS resolve
#   - nao faz o PC dormir. Se "Suspender depois de" for "nunca" (o caso aqui),
#     quem manda dormir e o usuario, pelo menu Iniciar.
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# O Chrome precisa de sessao grafica para passar pela Cloudflare. LogonType
# Interactive equivale a "Executar somente quando o usuario estiver conectado"
# na interface do Agendador. Sem isso a tarefa roda sem desktop e falha em
# silencio as 14h — que e o modo de quebra mais dificil de perceber.
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

function Register-OabTask {
    param(
        [string]$Name,
        [string]$Time,
        [string]$Arguments,
        [string]$Description
    )

    $Action = New-ScheduledTaskAction `
        -Execute $NodeExe `
        -Argument $Arguments `
        -WorkingDirectory $LinkPath

    # Segunda a sexta so. O Diario nao circula no fim de semana, e -WakeToRun
    # faria a maquina acordar sabado e domingo para nao colher nada. O corte
    # tambem existe no codigo (src/index.js), porque tarefa registrada ha meses
    # nao se corrige sozinha — aqui e para nao acordar o PC a toa.
    $Trigger = New-ScheduledTaskTrigger -Weekly `
        -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday `
        -At $Time

    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }

    Register-ScheduledTask `
        -TaskName $Name `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description $Description | Out-Null

    Write-Host "Registrada: $Name ($Time)"
}

Register-OabTask -Name 'OAB Publicacoes - 14h' -Time '14:00' `
    -Arguments 'src\index.js' `
    -Description 'Consulta as publicacoes do dia na OAB SP e envia por e-mail e WhatsApp.'

Register-OabTask -Name 'OAB Publicacoes - retry 16h' -Time '16:00' `
    -Arguments 'src\index.js --retry' `
    -Description 'Retry condicional: so roda se o dia estiver vazio ou incompleto.'

Register-OabTask -Name 'OAB Publicacoes - retry 17h' -Time '17:00' `
    -Arguments 'src\index.js --retry' `
    -Description 'Retry condicional: so roda se o dia estiver vazio ou incompleto.'

# Guarda-noturno. Nao coleta nem reenvia: le o estado e avisa se o dia nao
# fechou. Existe porque silencio hoje significa duas coisas opostas — "nao
# havia publicacao" e "a automacao falhou sem conseguir avisar".
Register-OabTask -Name 'OAB Publicacoes - checagem 18h' -Time '18:00' `
    -Arguments 'scripts\checar-dia.js' `
    -Description 'Confere se o dia fechou (entrega por todos os canais, fontes inteiras) e avisa se nao.'

Write-Host ''
Write-Host 'Pronto. Para conferir:'
Write-Host '  Get-ScheduledTask -TaskName "OAB Publicacoes*"'
Write-Host ''
Write-Host 'Teste rodando a tarefa manualmente pelo Agendador — o ambiente dela'
Write-Host 'e diferente do terminal, e e ali que erro de caminho aparece.'

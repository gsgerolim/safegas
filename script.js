"use strict";

/* =========================================================
   CONFIGURAÇÕES DO SITE
   ========================================================= */

// Limites de exibição.
// Devem ser iguais aos limites configurados no ESP32.
const LIMITE_GAS = 2000;
const LIMITE_FUMACA = 1000;

// true = permite testar a interface com dados simulados.
const PERMITIR_DEMONSTRACAO = true;

// Histórico máximo de eventos exibidos.
const MAXIMO_EVENTOS = 100;

/* =========================================================
   VARIÁVEIS DO SISTEMA
   ========================================================= */

let conectado = false;
let modoDemonstracao = false;

// Valores mais recentes recebidos do ESP32.
let dadosAtuais = {
  gas: null,
  fumaca: null,
  alertaGas: false,
  alertaFumaca: false,
  exaustor: false,
  valvula: false,
};

// Guardamos os estados anteriores para detectar mudanças.
let estadoAnterior = null;

// Conexão BLE: será preenchida quando conectarmos.
let dispositivoBLE = null;
let servidorBLE = null;
let caracteristicaBLE = null;

// Temporizador usado apenas na demonstração.
let temporizadorDemonstracao = null;

/* =========================================================
   ELEMENTOS DA PÁGINA
   ========================================================= */

const elementos = {
  statusConexao: document.getElementById("statusConexao"),
  textoConexao: document.getElementById("textoConexao"),
  mensagemConexao: document.getElementById("mensagemConexao"),

  btnConectar: document.getElementById("btnConectar"),
  btnDesconectar: document.getElementById("btnDesconectar"),
  btnDemonstracao: document.getElementById("btnDemonstracao"),
  btnLimparHistorico: document.getElementById("btnLimparHistorico"),

  indicadorAmbiente: document.getElementById("indicadorAmbiente"),
  ultimaAtualizacao: document.getElementById("ultimaAtualizacao"),

  valorGas: document.getElementById("valorGas"),
  statusGas: document.getElementById("statusGas"),

  valorFumaca: document.getElementById("valorFumaca"),
  statusFumaca: document.getElementById("statusFumaca"),

  statusExaustor: document.getElementById("statusExaustor"),
  statusValvula: document.getElementById("statusValvula"),

  listaHistorico: document.getElementById("listaHistorico"),
  historicoVazio: document.getElementById("historicoVazio"),
};

/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

document.addEventListener("DOMContentLoaded", iniciarSite);

function iniciarSite() {
  // Prepara os botões.
  elementos.btnConectar.addEventListener("click", conectarBluetooth);
  elementos.btnDesconectar.addEventListener("click", desconectarBluetooth);
  elementos.btnDemonstracao.addEventListener("click", alternarDemonstracao);
  elementos.btnLimparHistorico.addEventListener("click", limparHistorico);

  // Informa se o navegador suporta Web Bluetooth.
  if (!navigator.bluetooth) {
    elementos.mensagemConexao.textContent =
      "Este navegador não oferece Web Bluetooth. " +
      "Use um navegador compatível, como Chrome ou Edge em um ambiente suportado.";
  }

  registrarEvento("Sistema iniciado. Aguardando conexão.");
  atualizarInterfaceConexao("desconectado");
}

/* =========================================================
   CONEXÃO BLUETOOTH
   ========================================================= */

/*
  IMPORTANTE:

  Esta função está preparada para a estrutura BLE, mas os
  identificadores do serviço e da característica precisam
  corresponder ao firmware instalado no ESP32.

  Esta versão espera receber texto pela característica BLE.
*/

async function conectarBluetooth() {
  if (!navigator.bluetooth) {
    registrarEvento("Navegador sem suporte a Web Bluetooth.");
    atualizarInterfaceConexao("erro");
    return;
  }

  try {
    elementos.mensagemConexao.textContent =
      "Selecione o dispositivo ESP32 na janela do navegador.";

    // O ESP32 deverá anunciar o serviço BLE configurado.
    // O UUID abaixo é apenas um exemplo e precisa coincidir
    // com o UUID usado no código do ESP32.
    const UUID_SERVICO = "12345678-1234-1234-1234-1234567890ab";
    const UUID_CARACTERISTICA = "12345678-1234-1234-1234-1234567890ac";

    dispositivoBLE = await navigator.bluetooth.requestDevice({
      filters: [{ name: "MonitorAmbiental" }],
      optionalServices: [UUID_SERVICO],
    });

    // Se a conexão for encerrada pelo dispositivo,
    // atualizamos a interface.
    dispositivoBLE.addEventListener("gattserverdisconnected", aoDesconectarBLE);

    servidorBLE = await dispositivoBLE.gatt.connect();

    const servico = await servidorBLE.getPrimaryService(UUID_SERVICO);

    caracteristicaBLE = await servico.getCharacteristic(UUID_CARACTERISTICA);

    // Receberemos notificações sempre que o ESP32 enviar dados.
    await caracteristicaBLE.startNotifications();

    caracteristicaBLE.addEventListener(
      "characteristicvaluechanged",
      receberDadosBLE
    );

    conectado = true;
    modoDemonstracao = false;

    pararDemonstracao();

    atualizarInterfaceConexao("conectado");
    registrarEvento("Bluetooth conectado ao ESP32.");
  } catch (erro) {
    console.error("Erro Bluetooth:", erro);

    registrarEvento("Falha na conexão Bluetooth.");
    atualizarInterfaceConexao("erro");

    elementos.mensagemConexao.textContent =
      "Não foi possível conectar. Verifique o BLE do ESP32 e tente novamente.";
  }
}

/* =========================================================
   RECEBIMENTO DAS MENSAGENS BLE
   ========================================================= */

function receberDadosBLE(evento) {
  // Converte os bytes recebidos em texto.
  const valor = evento.target.value;
  const decodificador = new TextDecoder("utf-8");
  const mensagem = decodificador.decode(valor);

  // O ESP32 pode enviar uma mensagem por notificação.
  // Cada mensagem deve seguir o protocolo combinado.
  processarMensagem(mensagem.trim());
}

/* =========================================================
   INTERPRETAÇÃO DAS MENSAGENS
   ========================================================= */

/*
  Formato de leitura:
  DADOS;GAS;FUMACA;ALERTA_GAS;ALERTA_FUMACA;EXAUSTOR;VALVULA

  Exemplo:
  DADOS;2450;680;1;0;1;0

  Formato de evento:
  EVENTO;ALERTA_GAS
*/

function processarMensagem(mensagem) {
  const partes = mensagem.split(";");

  if (partes.length === 0) {
    return;
  }

  // Mensagem de leitura dos sensores e atuadores.
  if (partes[0] === "DADOS" && partes.length >= 7) {
    const novosDados = {
      gas: Number(partes[1]),
      fumaca: Number(partes[2]),
      alertaGas: partes[3] === "1",
      alertaFumaca: partes[4] === "1",
      exaustor: partes[5] === "1",
      valvula: partes[6] === "1",
    };

    // Ignora leituras inválidas.
    if (
      !Number.isFinite(novosDados.gas) ||
      !Number.isFinite(novosDados.fumaca)
    ) {
      registrarEvento("Mensagem recebida com valores inválidos.");
      return;
    }

    atualizarDados(novosDados);
    return;
  }

  // Mensagem de evento enviada pelo ESP32.
  if (partes[0] === "EVENTO" && partes.length >= 2) {
    const evento = partes.slice(1).join(";");

    registrarEvento(traduzirEvento(evento));
    return;
  }

  console.warn("Mensagem não reconhecida:", mensagem);
}

/* =========================================================
   ATUALIZAÇÃO DAS LEITURAS
   ========================================================= */

function atualizarDados(novosDados) {
  dadosAtuais = novosDados;

  // Atualiza os valores apresentados na tela.
  elementos.valorGas.textContent = dadosAtuais.gas;
  elementos.valorFumaca.textContent = dadosAtuais.fumaca;

  // Atualiza os estados dos sensores.
  atualizarEstadoSensor(elementos.statusGas, dadosAtuais.alertaGas);

  atualizarEstadoSensor(elementos.statusFumaca, dadosAtuais.alertaFumaca);

  // Atualiza os atuadores.
  atualizarEstadoAtuador(
    elementos.statusExaustor,
    dadosAtuais.exaustor,
    "Ligado",
    "Desligado"
  );

  atualizarEstadoAtuador(
    elementos.statusValvula,
    dadosAtuais.valvula,
    "Aberta",
    "Fechada"
  );

  // Atualiza o status geral.
  atualizarEstadoAmbiente();

  // Registra somente as mudanças importantes.
  verificarMudancasDeEstado();

  // Exibe o horário da última leitura recebida.
  elementos.ultimaAtualizacao.textContent =
    "Última atualização: " + obterHorario();
}

/* =========================================================
   ESTADOS VISUAIS
   ========================================================= */

function atualizarEstadoSensor(elemento, emAlerta) {
  elemento.textContent = emAlerta ? "Alerta" : "Normal";

  elemento.className = emAlerta
    ? "badge text-bg-danger"
    : "badge text-bg-success";
}

function atualizarEstadoAtuador(elemento, ligado, textoLigado, textoDesligado) {
  elemento.textContent = ligado ? textoLigado : textoDesligado;

  elemento.className = ligado
    ? "badge text-bg-success"
    : "badge text-bg-secondary";
}

function atualizarEstadoAmbiente() {
  const existeAlerta = dadosAtuais.alertaGas || dadosAtuais.alertaFumaca;

  elementos.indicadorAmbiente.textContent = existeAlerta
    ? "ALERTA NO AMBIENTE"
    : "AMBIENTE NORMAL";

  elementos.indicadorAmbiente.className = existeAlerta
    ? "status-ambiente status-alerta my-3"
    : "status-ambiente status-normal my-3";
}

/* =========================================================
   DETECÇÃO DE MUDANÇAS PARA O HISTÓRICO
   ========================================================= */

function verificarMudancasDeEstado() {
  const atual = {
    alertaGas: dadosAtuais.alertaGas,
    alertaFumaca: dadosAtuais.alertaFumaca,
    exaustor: dadosAtuais.exaustor,
    valvula: dadosAtuais.valvula,
  };

  // Na primeira leitura, apenas guardamos o estado.
  if (estadoAnterior === null) {
    estadoAnterior = atual;
    return;
  }

  // Detecta mudança no gás.
  if (atual.alertaGas !== estadoAnterior.alertaGas) {
    registrarEvento(
      atual.alertaGas ? "Alerta de gás detectado." : "Gás voltou ao normal."
    );
  }

  // Detecta mudança na fumaça.
  if (atual.alertaFumaca !== estadoAnterior.alertaFumaca) {
    registrarEvento(
      atual.alertaFumaca
        ? "Alerta de fumaça detectado."
        : "Fumaça voltou ao normal."
    );
  }

  // Detecta mudança no exaustor.
  if (atual.exaustor !== estadoAnterior.exaustor) {
    registrarEvento(
      atual.exaustor ? "Exaustor ligado." : "Exaustor desligado."
    );
  }

  // Detecta mudança na válvula.
  if (atual.valvula !== estadoAnterior.valvula) {
    registrarEvento(atual.valvula ? "Válvula aberta." : "Válvula fechada.");
  }

  estadoAnterior = atual;
}

/* =========================================================
   HISTÓRICO DE EVENTOS
   ========================================================= */

function registrarEvento(mensagem) {
  // Cria um item para o histórico.
  const item = document.createElement("div");
  item.className = "list-group-item d-flex align-items-start gap-3";

  // Horário local do celular/computador.
  const horario = document.createElement("span");
  horario.className = "evento-horario";
  horario.textContent = obterHorario();

  // Texto do evento.
  const texto = document.createElement("span");
  texto.className = "evento-mensagem";
  texto.textContent = mensagem;

  item.appendChild(horario);
  item.appendChild(texto);

  // Evento mais recente aparece primeiro.
  elementos.listaHistorico.prepend(item);

  // Mostra ou esconde a mensagem de histórico vazio.
  elementos.historicoVazio.classList.add("d-none");

  // Mantém no máximo 100 eventos.
  while (elementos.listaHistorico.children.length > MAXIMO_EVENTOS) {
    elementos.listaHistorico.lastElementChild.remove();
  }
}

function limparHistorico() {
  elementos.listaHistorico.replaceChildren();
  elementos.historicoVazio.classList.remove("d-none");

  registrarEvento("Histórico limpo pelo usuário.");
}

/* =========================================================
   TRADUÇÃO DOS EVENTOS
   ========================================================= */

function traduzirEvento(evento) {
  const eventos = {
    SISTEMA_INICIADO: "Sistema iniciado no ESP32.",
    ALERTA_GAS: "Alerta de gás detectado.",
    ALERTA_FUMACA: "Alerta de fumaça detectado.",
    ALERTA_GAS_FUMACA: "Alerta de gás e fumaça detectados.",
    AMBIENTE_NORMAL: "Ambiente voltou ao normal.",
    EXAUSTOR_LIGADO: "Exaustor ligado.",
    EXAUSTOR_DESLIGADO: "Exaustor desligado.",
    VALVULA_ABERTA: "Válvula aberta.",
    VALVULA_FECHADA: "Válvula fechada.",
  };

  return eventos[evento] || "Evento recebido: " + evento;
}

/* =========================================================
   INTERFACE DE CONEXÃO
   ========================================================= */

function atualizarInterfaceConexao(estado) {
  const conectadoAgora = estado === "conectado";

  elementos.btnConectar.classList.toggle("d-none", conectadoAgora);

  elementos.btnDesconectar.classList.toggle("d-none", !conectadoAgora);

  if (estado === "conectado") {
    elementos.statusConexao.textContent = "Conectado";
    elementos.statusConexao.className = "badge text-bg-success";
    elementos.textoConexao.textContent = "Conectado";
    elementos.mensagemConexao.textContent = "Recebendo dados do ESP32.";
  } else if (estado === "erro") {
    elementos.statusConexao.textContent = "Erro";
    elementos.statusConexao.className = "badge text-bg-danger";
    elementos.textoConexao.textContent = "Erro na conexão";
  } else {
    elementos.statusConexao.textContent = "Desconectado";
    elementos.statusConexao.className = "badge text-bg-secondary";
    elementos.textoConexao.textContent = "Aguardando conexão";
  }
}

function aoDesconectarBLE() {
  conectado = false;
  dispositivoBLE = null;
  servidorBLE = null;
  caracteristicaBLE = null;

  atualizarInterfaceConexao("desconectado");
  registrarEvento("Bluetooth desconectado.");

  // Evita apresentar os valores antigos como se fossem atuais.
  limparLeituras();
}

async function desconectarBluetooth() {
  pararDemonstracao();

  if (dispositivoBLE && dispositivoBLE.gatt.connected) {
    dispositivoBLE.gatt.disconnect();
  } else {
    conectado = false;
    atualizarInterfaceConexao("desconectado");
    limparLeituras();
  }
}

function limparLeituras() {
  dadosAtuais = {
    gas: null,
    fumaca: null,
    alertaGas: false,
    alertaFumaca: false,
    exaustor: false,
    valvula: false,
  };

  estadoAnterior = null;

  elementos.valorGas.textContent = "---";
  elementos.valorFumaca.textContent = "---";

  elementos.statusGas.textContent = "Aguardando";
  elementos.statusFumaca.textContent = "Aguardando";

  elementos.statusGas.className = "badge text-bg-secondary";
  elementos.statusFumaca.className = "badge text-bg-secondary";

  elementos.statusExaustor.textContent = "Desconhecido";
  elementos.statusValvula.textContent = "Desconhecido";

  elementos.statusExaustor.className = "badge text-bg-secondary";
  elementos.statusValvula.className = "badge text-bg-secondary";

  elementos.indicadorAmbiente.textContent = "AGUARDANDO DADOS";
  elementos.indicadorAmbiente.className = "status-ambiente status-neutro my-3";

  elementos.ultimaAtualizacao.textContent = "Nenhuma leitura recebida.";
}

/* =========================================================
   MODO DEMONSTRAÇÃO
   ========================================================= */

/*
  Permite testar a aparência do site sem o ESP32.

  Os dados abaixo são inventados e servem somente para
  demonstração. Eles não representam medições reais.
*/

function alternarDemonstracao() {
  if (!PERMITIR_DEMONSTRACAO) {
    return;
  }

  if (modoDemonstracao) {
    pararDemonstracao();
    atualizarInterfaceConexao("desconectado");
    limparLeituras();
    registrarEvento("Modo demonstração encerrado.");
    return;
  }

  // Se houver conexão real, desconectamos antes de simular.
  if (dispositivoBLE && dispositivoBLE.gatt.connected) {
    dispositivoBLE.gatt.disconnect();
  }

  conectado = false;
  modoDemonstracao = true;

  atualizarInterfaceConexao("desconectado");

  elementos.statusConexao.textContent = "Demonstração";
  elementos.statusConexao.className = "badge text-bg-info";
  elementos.textoConexao.textContent = "Modo demonstração";
  elementos.mensagemConexao.textContent =
    "Os valores exibidos são simulados, não são leituras reais.";

  registrarEvento("Modo demonstração iniciado.");

  // Atualiza a tela com valores simulados a cada 2 segundos.
  simularLeitura();
  temporizadorDemonstracao = setInterval(simularLeitura, 2000);
}

function simularLeitura() {
  if (!modoDemonstracao) {
    return;
  }

  // Alterna entre normal e alerta para testar a interface.
  const emAlerta = Math.random() > 0.7;

  const gas = emAlerta
    ? LIMITE_GAS + Math.floor(Math.random() * 500)
    : Math.floor(Math.random() * LIMITE_GAS);

  const fumaca = emAlerta
    ? LIMITE_FUMACA + Math.floor(Math.random() * 300)
    : Math.floor(Math.random() * LIMITE_FUMACA);

  const alertaGas = gas >= LIMITE_GAS;
  const alertaFumaca = fumaca >= LIMITE_FUMACA;
  const alertaGeral = alertaGas || alertaFumaca;

  atualizarDados({
    gas,
    fumaca,
    alertaGas,
    alertaFumaca,
    exaustor: alertaGeral,
    valvula: alertaGeral,
  });
}

function pararDemonstracao() {
  modoDemonstracao = false;

  if (temporizadorDemonstracao !== null) {
    clearInterval(temporizadorDemonstracao);
    temporizadorDemonstracao = null;
  }
}

/* =========================================================
   UTILITÁRIO: HORÁRIO
   ========================================================= */

function obterHorario() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

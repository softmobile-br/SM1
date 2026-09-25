# SM1 1.4.2

Aplicativo casca 100% Cordova da SoftMobile.

## Fluxo

1. Ao iniciar, exibe uma Splash Screen responsiva com o logotipo SoftMobile.
2. Se as duas RESTs ainda nao estiverem gravadas no aparelho, abre a configuracao inicial.
3. O usuario informa uma unica vez:
   - REST de redirecionamento;
   - REST de registro FCM.
4. As duas URLs sao gravadas permanentemente no aparelho via `cordova-plugin-nativestorage`.
5. O Firebase gera/recupera automaticamente o token FCM individual daquela instalacao. O usuario nao informa token.
6. O SM1 se inscreve automaticamente no topico FCM fixo `sm1_all`.
7. O SM1 envia o token individual para a REST de registro e abre automaticamente a URL obtida pela REST de redirecionamento.
8. Nas proximas execucoes, a tela de configuracao nao e exibida.
9. O botao Voltar do Android nao percorre o historico interno do redirecionamento; ele reabre a URL-base indicada pela REST.

## Icone Android

Os icones de launcher ficam em `res/icon/android/` e sao gerados a partir do logotipo oficial SoftMobile. O `config.xml` associa cada arquivo a sua densidade Android.

## REST de redirecionamento

Metodo: `GET`

Pode retornar texto simples:

```text
https://sistema.exemplo.com.br/
```

ou JSON:

```json
{
  "url": "https://sistema.exemplo.com.br/"
}
```

Tambem sao aceitos `startUrl` e `redirectUrl` no JSON.

## REST de registro FCM

Metodo: `POST`

O token nao e fornecido pelo usuario nem pela REST. O proprio Firebase gera o token em cada instalacao.

O aplicativo envia automaticamente:

```json
{
  "app": "SM1",
  "token": "TOKEN_FCM_DESTA_INSTALACAO",
  "topic": "sm1_all",
  "platform": "android",
  "packageId": "com.softmobile.sm1"
}
```

A REST deve apenas responder HTTP 2xx. O topico `sm1_all` e controlado pelo proprio app.

## Notificacao coletiva

Cada aparelho possui seu proprio token FCM, mas todos sao inscritos automaticamente em:

```text
sm1_all
```

Uma mensagem enviada pelo Firebase ao topico `sm1_all` sera destinada as instalacoes inscritas nesse topico.

O topico nao precisa ser criado manualmente no Firebase Console e nao fica dentro do `google-services.json`.

## Persistencia

As duas URLs permanecem armazenadas no aparelho ao fechar o app ou reiniciar o dispositivo. Elas sao removidas se os dados do aplicativo forem apagados ou se o app for desinstalado.

## Firebase

Antes do build Android:

1. No Firebase, cadastre um app Android com package `com.softmobile.sm1`.
2. Baixe o arquivo `google-services.json`.
3. Coloque o arquivo na raiz do projeto, ao lado de `config.xml`.
4. Nao altere o arquivo para adicionar `sm1_all`; a inscricao no topico e feita pelo codigo do SM1.

Estrutura esperada:

```text
SM1/
|-- google-services.json
|-- config.xml
|-- package.json
|-- www/
```

## Build

```bash
npm install
cordova platform add android
cordova build android
```

O projeto tambem esta preparado para build Cordova no Ionic Appflow.

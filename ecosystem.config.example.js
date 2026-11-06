// Jednodušší je nastavení v .env (viz .env.example), server ho načte sám.
// Kdo chce nastavení radši v pm2: zkopíruj do ecosystem.config.js (ten je v .gitignore) a doplň hodnoty.
// Hodnoty tady mají přednost před .env.
module.exports = {
  apps: [{
    name: "goralia",
    script: "server/server.js",
    env: {
      PORT: "3100",
      PUBLIC_URL: "https://goralia.cz",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      FACEBOOK_APP_ID: "",
      FACEBOOK_APP_SECRET: ""
    }
  }]
};

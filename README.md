## Setup full developmnet environment

```
# new terminal
gh repo clone alephium/alephium
cd alephium
ulimit -S -n 2048
sbt app/assembly
java -jar app/target/scala-2.13/alephium*.jar

# new terminal
curl https://github.com/alephium/explorer-backend/releases/download/v3.3.3/explorer-backend-3.3.3.jar
brew services start postgresql
BLOCKFLOW_NETWORK_ID=4 java -jar explorer-backend-3.3.3.jar

# new terminal
yarn global add verdaccio
npx verdaccio

# new terminal
gh repo clone zetamarket/typescript-sdk
cd typescript-sdk
yarn config set registry http://localhost:4873
yarn
yarn publish --patch

# new terminal
gh repo clone zetamarket/frontend
cd frontend
yarn config set registry http://localhost:4873
yarn add @zetamarket/typescript-sdk@0.0.$VERSION
yarn dev

# new terminal
gh repo clone zetamarket/dex-contract
cd dex-contract
yarn
npx cli compile
npx cli deploy
npx http-server node_modules -p 4000 --cors
rsync -a artifacts/ ../typescript-sdk/clmm/artifacts/
rsync -a deployments/ ../typescript-sdk/clmm/deployments/

#new terminal
gh repo clone zetamarket/backend
cd backend
curl -fsSL https://bun.sh/install | bash
npm config set registry http://localhost:4873
bun install
```
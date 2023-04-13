const generateSharedFunctionPackageJson = (name) => `{
    "name": "${name}",
    "version": "0.0.1",
    "main": "index.js",
    "scripts": {
      "start": "node index.js",
      "prepare": "npx husky install",
      "test": "npx jest",
      "lint:fix": "npx eslint *.js --fix",
      "format": "npx prettier ./**/*{.js,.json} --write",
      "pre-commit": "npx lint-staged"
    },
    "lint-staged": {
      "*.js": [
        "npm run lint:fix",
        "npm run format"
      ]
    },
    "type": "module",
    "license": "ISC",
    "dependencies": {},
    "devDependencies":{
      "@types/node":"16.9.6",
      "@types/eslint":"7.28.1",
      "@types/jest":"27.4.0",
      "jest":"27.4.3",
      "eslint":"8.13.0", 
      "eslint-config-airbnb-base": "15.0.0",
      "eslint-config-prettier": "8.3.0",
      "eslint-plugin-import": "2.25.2",
      "husky":"7.0.0",
      "lint-staged":"11.2.3",
      "prettier":"2.4.1",
      "@commitlint/config-conventional": "15.0.0",
      "@commitlint/cli": "15.0.0",
      "standard-version":"^9.5.0"
    }
  }
`

module.exports = { generateSharedFunctionPackageJson }

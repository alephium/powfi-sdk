// Handle BigInt serialization for Jest
global.BigInt.prototype.toJSON = function () {
  return this.toString();
};

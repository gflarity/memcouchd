//Obligatory CouchFactory... It's cleaner anyways :)
var Couch = require('./couch').Couch;

//TODO this should be clean and consistent
var CouchFactory = function( store_name, args ) {
    this.store = require(store_name);
}
exports.CouchFactory = CouchFactory;

CouchFactory.prototype.newCouch = function() {
    return new Couch( this.store );
}

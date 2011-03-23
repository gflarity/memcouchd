//Obligatory CouchFactory... It's cleaner anyways :)
var CouchFrame = require('./couch_frame').CouchFrame;

//TODO this should be clean and consistent
var CouchFactory = function( store_name, args ) {
    this.store = require(store_name);
}
exports.CouchFactory = CouchFactory;

CouchFactory.prototype.newCouch = function() {
    return new CouchFrame( this.store );
}
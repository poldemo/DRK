/*
 * Copyright (C) 2007  Camptocamp
 *
 * This file is part of MapFish Client
 *
 * MapFish Client is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * MapFish Client is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with MapFish Client.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * @requires OpenLayers/Util.js
 * @requires OpenLayers/Protocol/HTTP.js
 * @requires OpenLayers/Feature/Vector.js
 * @requires OpenLayers/Format/GeoJSON.js
 * @requires OpenLayers/Filter/Comparison.js
 * @requires core/Protocol.js
 */

/**
 * Class: mapfish.Protocol.MapFish
 * MapFish Protocol class. This class is a decorator class to
 * <OpenLayers.Protocol.HTTP>
 *
 * Inherits from:
 * - <OpenLayers.Protocol.HTTP>
 */

mapfish.Protocol.MapFish = OpenLayers.Class(OpenLayers.Protocol.HTTP, {
    /**
     * APIProperty: wildcarded.
     * {Boolean} If true percent signs are added around values 
     *     read from LIKE filters, for example if the protocol
     *     read method is passed a LIKE filter whose property
     *     is "foo" and whose value is "bar" the string
     *     "foo__ilike=%bar%" will be sent in the query string;
     *     defaults to false.
     */
    wildcarded: false,

    /**
     * Constructor: mapfish.Protocol.MapFish
     *
     * Parameters:
     * options - {Object}
     */
    initialize: function(options) {
        options = options || {};
        if (!options.format) {
            options.format = new OpenLayers.Format.GeoJSON();
        }
        OpenLayers.Protocol.HTTP.prototype.initialize.call(this, options);
    },

    /**
     * APIMethod: create
     *      Create features.
     *
     * Parameters:
     * features - {Array({<OpenLayers.Feature.Vector>})} or
     *            {<OpenLayers.Feature.Vector>}
     * options - {Object} Optional object for configuring the request.
     *     This object is modified and should not be reused.
     *
     * Returns:
     * {<OpenLayers.Protocol.Response>} An <OpenLayers.Protocol.Response>
     *      object, whose "priv" property references the HTTP request, this
     *      object is also passed to the callback function when the request
     *      completes, its "features" property is then populated with the
     *      the features received from the server.
     */
    "create": function(features, options) {
        options = options || {};
        options.headers = OpenLayers.Util.extend(
            options.headers, {"Content-Type": "plain/text"});
        return OpenLayers.Protocol.HTTP.prototype.create.call(
            this, features, options);
    },

    /**
     * Method: handleCreate
     * This method overrides that of the parent class, this is to be more
     * restrictive on HTTP status code.
     *
     * Parameters:
     * resp - {<OpenLayers.Protocol.Response>} The response object to pass to
     *     any user callback.
     * options - {Object} The user options passed to the create call.
     */
    handleCreate: function(resp, options) {
        this.handleCreateUpdate(resp, options);
    },

    /**
     * APIMethod: read
     * Construct a request for reading new features.
     *
     * Parameters:
     * options - {Object} Optional object for configuring the request.
     *     This object is modified and should not be reused.
     *
     * Returns:
     * {<OpenLayers.Protocol.Response>} An <OpenLayers.Protocol.Response>
     *      object, whose "priv" property references the HTTP request, this
     *      object is also passed to the callback function when the request
     *      completes, its "features" property is then populated with the
     *      the features received from the server.
     */
    "read": function(options) {
        // workaround a bug in OpenLayers
        options.params = OpenLayers.Util.applyDefaults(
            options.params, this.options.params);
        if (options) {
            this.filterAdapter(options);
        }
        return OpenLayers.Protocol.HTTP.prototype.read.call(
            this, options);
    },

    /**
     * Method: handleRead
     * This method overrides that of the parent class, this is to be more
     * restrictive on HTTP status code.
     *
     * Parameters:
     * resp - {<OpenLayers.Protocol.Response>} The response object to pass to
     *     the user callback.
     * options - {Object} The user options passed to the read call.
     */
    handleRead: function(resp, options) {
        var request = resp.priv;
        if (options.callback) {
            var code = request.status;
            if (code == 200) {
                // success
                resp.features = this.parseFeatures(request);
                resp.code = OpenLayers.Protocol.Response.SUCCESS;
            } else {
                // failure
                resp.features = null;
                resp.code = OpenLayers.Protocol.Response.FAILURE;
            }
            options.callback.call(options.scope, resp);
        }
    },

    /**
     * Method: _filterToParams
     *      Private method to convert a <OpenLayers.Filter> object to key/values
     *      in an object.
     *
     * Parameters:
     * filter - {OpenLayers.Filter} filter to convert.
     * params - {Object} Object where to store the result.
     *
     * Returns:
     * {Boolean} True if the conversion suceeded, false otherwise.
     */
    _filterToParams: function(filter, params) {
        var className = filter.CLASS_NAME;
        var str = className.substring(
            className.indexOf('.') + 1, className.lastIndexOf('.')
        );
        if (str != "Filter") {
            // bail out
            return false;
        }
        var filterType = className.substring(className.lastIndexOf('.') + 1);

        switch (filterType) {
            case "Spatial":
                var type = filter.type;
                switch (type) {
                    case OpenLayers.Filter.Spatial.BBOX:
                        if (params["bbox"]) {
                            OpenLayers.Console.error('Filter contains multiple ' +
                                                     'Spatial BBOX entries');
                            // We should merge with the old bbox, but OL does not
                            // proving geometry merging.
                            return false;
                        }
                        params["bbox"] = filter.value.toBBOX();
                        break;
                    case OpenLayers.Filter.Spatial.DWITHIN:
                        params["tolerance"] = filter.distance;
                    case OpenLayers.Filter.Spatial.WITHIN:
                        if (params["lon"]) {
                            OpenLayers.Console.error('Filter contains multiple ' +
                                                     'Spatial *WITHIN entries');
                            return false;
                        }
                        params["lon"] = filter.value.x;
                        params["lat"] = filter.value.y;
                        break;
                    default:
                        OpenLayers.Console.warn('Unknown spatial filter type ' +
                                                type);
                        return false;
                }
                break;
            case "Comparison":
                var op = mapfish.Protocol.MapFish.COMP_TYPE_TO_OP_STR[filter.type];
                if (op === undefined) {
                    OpenLayers.Console.error(
                        'Unknown comparison filter type ' + filter.type);
                    return false;
                }
                var value = filter.value;
                if (filter.type == OpenLayers.Filter.Comparison.LIKE) {
                    value = this.regex2value(value);
                    if (this.wildcarded) {
                        value = "%" + value + "%";
                    }
                }
                params[filter.property + "__" + op] = value;
                params["queryable"] = params["queryable"] || [];
                params["queryable"].push(filter.property);
                break;
            case "Logical":
                if (filter.type != OpenLayers.Filter.Logical.AND) {
                    OpenLayers.Console.error('Unsupported logical filter type ' +
                                             filter.type);
                    return false;
                }
                if (filter.filters.length == 0) {
                    OpenLayers.Console.error('Empty logical AND filter');
                    return false;
                }
                for (var i = 0; i < filter.filters.length; i++) {
                    var f = filter.filters[i];
                    if (!this._filterToParams(f, params))
                        return false;
                }
                break;
            default:
                OpenLayers.Console.warn("Unknown filter type " + filterType);
                return false;
        }
        return true;
    },

    /**
     * Method: regex2value
     * Convert the value from a regular expression string to a LIKE/ILIKE
     *     string known to the MapFish web service.
     *
     * Parameters:
     * value - {String} The regex string.
     *
     * Returns:
     * {String} The converted string.
     */
    regex2value: function(value) {

        // highly sensitive!! Do not change this without running the
        // Protocol/MapFish.html unit tests

        // convert % to \%
        value = value.replace(/%/g, "\\%");

        // convert \\. to \\_ (\\.* occurences converted later)
        value = value.replace(/\\\\\.(\*)?/g, function($0, $1) {
            return $1 ? $0 : "\\\\_";
        });

        // convert \\.* to \\%
        value = value.replace(/\\\\\.\*/g, "\\\\%");

        // convert . to _ (\. and .* occurences converted later)
        value = value.replace(/(\\)?\.(\*)?/g, function($0, $1, $2) {
            return $1 || $2 ? $0 : "_";
        });

        // convert .* to % (\.* occurnces converted later)
        value = value.replace(/(\\)?\.\*/g, function($0, $1) {
            return $1 ? $0 : "%";
        });

        // convert \. to .
        value = value.replace(/\\\./g, ".");

        // replace \* with * (watching out for \\*)
        value = value.replace(/(\\)?\\\*/g, function($0, $1) {
            return $1 ? $0 : "*";
        });
        
        return value;
    },

    /**
     * Method: filterAdapter
     *      If params has a filter property and if that filter property
     *      is an OpenLayers.Filter that the MapFish protocol can deal
     *      with, the filter is adapted to the MapFish protocol.
     *
     * Parameters:
     * options - {Object}
     */
    filterAdapter: function(options) {
        if (!options ||
            !options.filter ||
            !options.filter.CLASS_NAME) {
            // bail out
            return;
        }

        var params = {};
        if (this._filterToParams(options.filter, params)) {
            options.params = OpenLayers.Util.extend(options.params, params);
        }
        delete options.filter;
    },

    /**
     * APIMethod: update
     * Construct a request updating modified features.
     *
     * Parameters:
     * features - {Array({<OpenLayers.Feature.Vector>})} or
     *            {<OpenLayers.Feature.Vector>}
     * options - {Object} Optional object for configuring the request.
     *     This object is modified and should not be reused.
     *
     * Returns:
     * {<OpenLayers.Protocol.Response>} An <OpenLayers.Protocol.Response>
     *      object, whose "priv" property references the HTTP request, this
     *      object is also passed to the callback function when the request
     *      completes, its "features" property is then populated with the
     *      the features received from the server.
     */
    "update": function(features, options) {
        options = options || {};
        var url = options.url ||
                  features.url ||
                  this.options.url + '/' + features.fid;
        options.url = url;
        options.headers = OpenLayers.Util.extend(
            options.headers, {"Content-Type": "plain/text"});
        return OpenLayers.Protocol.HTTP.prototype.update.call(
            this, features, options);
    },

    /**
     * Method: handleUpdate
     * This method overrides that of the parent class, this is to be more
     * restrictive on HTTP status code.
     *
     * Parameters:
     * resp - {<OpenLayers.Protocol.Response>} The response object to pass to
     *     any user callback.
     * options - {Object} The user options passed to the update call.
     */
    handleUpdate: function(resp, options) {
        this.handleCreateUpdate(resp, options);
    },

    /**
     * Method: handleCreateUpdate
     *
     * Parameters:
     * resp - {<OpenLayers.Protocol.Response>} The response object to pass to
     *     any user callback.
     * options - {Object} The user options passed to the update call.
     */
    handleCreateUpdate: function(resp, options) {
        var request = resp.priv;
        if (options.callback) {
            var code = request.status;
            if (code == 201) {
                // success
                resp.features = this.parseFeatures(request);
                resp.code = OpenLayers.Protocol.Response.SUCCESS;
            } else {
                // failure
                resp.features = null;
                resp.code = OpenLayers.Protocol.Response.FAILURE;
            }
            options.callback.call(options.scope, resp);
        }
    },

    /**
     * APIMethod: delete
     * Construct a request deleting a removed feature.
     *
     * Parameters:
     * feature - {<OpenLayers.Feature.Vector>}
     * options - {Object} Optional object for configuring the request.
     *     This object is modified and should not be reused.
     *
     * Returns:
     * {<OpenLayers.Protocol.Response>} An <OpenLayers.Protocol.Response>
     *      object, whose "priv" property references the HTTP request, this
     *      object is also passed to the callback function when the request
     *      completes.
     */
    "delete": function(feature, options) {
        options = options || {};
        var url = options.url ||
                  feature.url ||
                  this.options.url + '/' + feature.fid;
        options.url = url;
        return OpenLayers.Protocol.HTTP.prototype["delete"].call(
            this, feature, options);
    },

    /**
     * Method: handleDelete
     *
     * Parameters:
     * resp - {<OpenLayers.Protocol.Response>} The response object to pass to
     *     any user callback.
     * options - {Object} The user options passed to the delete call.
     */
    handleDelete: function(resp, options) {
        var request = resp.priv;
        if (options.callback) {
            var code = request.status;
            if (code == 204) {
                // success
                resp.code = OpenLayers.Protocol.Response.SUCCESS;
            } else {
                // failure
                resp.code = OpenLayers.Protocol.Response.FAILURE;
            }
            options.callback.call(options.scope, resp);
        }
    },

    CLASS_NAME: "mapfish.Protocol.MapFish"
});

/**
 * Property: mapfish.Protocol.MapFish.COMP_TYPE_TO_OP_STR
 * {Object} A private class-level property mapping the
 *     OpenLayers.Filter.Comparison types to the operation
 *     strings of the MapFish Protocol.
 */
mapfish.Protocol.MapFish.COMP_TYPE_TO_OP_STR = {};
(function() {
    var o = mapfish.Protocol.MapFish.COMP_TYPE_TO_OP_STR;
    o[OpenLayers.Filter.Comparison.EQUAL_TO] = "eq";
    o[OpenLayers.Filter.Comparison.NOT_EQUAL_TO] = "ne";
    o[OpenLayers.Filter.Comparison.LESS_THAN] = "lt";
    o[OpenLayers.Filter.Comparison.LESS_THAN_OR_EQUAL_TO] = "lte";
    o[OpenLayers.Filter.Comparison.GREATER_THAN] = "gt";
    o[OpenLayers.Filter.Comparison.GREATER_THAN_OR_EQUAL_TO] = "gte";
    o[OpenLayers.Filter.Comparison.LIKE] = "ilike";
})();

/**
 * APIFunction: create
 * Shortcut to create MapFish Protocol decorated with TriggerEventDecorator
 *     and MergeFilterDecorator
 *
 * Example of use:
 * (start code)
 * var protocol = mapfish.Protocol.MapFish.create({
 *     url: url,
 * });
 * (end)
 *
 * Parameters:
 * config - {Object} The config of the decorated MapFish protocol
 *
 * Returns:
 * {<mapfish.Protocol.MapFish>} The resulting protocol.
 * */
mapfish.Protocol.MapFish.create = function(config) {
    return mapfish.Protocol.decorateProtocol({
        protocol: new mapfish.Protocol.MapFish(config),
        MergeFilterDecorator: null,
        TriggerEventDecorator: null
    });
};


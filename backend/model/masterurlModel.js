const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MasterUrl = sequelize.define("masterurl", {
  linkedin_link_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  linkedin_link: {
    type: DataTypes.TEXT,
    // allowNull: false,
    // unique: true,
  },
  clean_linkedin_link: {
    type: DataTypes.TEXT,
    // allowNull: true,
  },
  linkedin_link_remark: {
    type: DataTypes.TEXT,
    // allowNull: true,
  }
},
{
  timestamps:false,
});
module.exports = MasterUrl;
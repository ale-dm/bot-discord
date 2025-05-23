// api.js
const axios = require('axios');
const FormData = require('form-data');
const { logError } = require('./logger');  // Importamos la función desde logger.js

async function callApi(text) {
    const apiUrl = 'https://api.simsimi.vn/v1/simtalk'; // URL de la API

    // Crear una nueva instancia de FormData
    const form = new FormData();
    form.append('text', text);  // El texto que el usuario ingresa
    form.append('lc', 'es');    // El idioma (español en este caso)

    try {
        // Realizamos la solicitud POST usando FormData y encabezados correctos
        const response = await axios.post(apiUrl, form, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...form.getHeaders(),  // Esto asegura que los encabezados de Content-Type sean correctos
            }
        });

        // Verificamos si la respuesta contiene el mensaje esperado
        if (response.data && response.data.message) {
            return response.data.message;  // Retornar el mensaje de la API
        } else {
            throw new Error('No se encontró el mensaje en la respuesta de la API.');
        }
    } catch (error) {
        logError('Error al llamar la API:', error);
        throw new Error('Hubo un error al contactar con la API.');
    }
}

module.exports = { callApi };

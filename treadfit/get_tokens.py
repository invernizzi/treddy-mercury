import cherrypy
import sys
import os
import threading
import traceback
import webbrowser
from dotenv import load_dotenv, set_key

from fitbit.api import Fitbit
from oauthlib.oauth2.rfc6749.errors import MismatchingStateError, MissingTokenError


class OAuth2Server:
    def __init__(self, client_id, client_secret, redirect_uri="http://127.0.0.1:8080/"):
        self.success_html = """
            <h1>You are now authorized to access the Fitbit API!</h1>
            <br/><h3>You can close this window</h3>"""
        self.failure_html = """
            <h1>ERROR: %s</h1><br/><h3>You can close this window</h3>"""

        self.fitbit = Fitbit(
            client_id,
            client_secret,
            redirect_uri=redirect_uri,
            timeout=10,
        )
        self.redirect_uri = redirect_uri

    def browser_authorize(self):
        # Open the authorization URL in the browser
        url, _ = self.fitbit.client.authorize_token_url()
        threading.Timer(1, webbrowser.open, args=(url,)).start()

        # Configure CherryPy
        cherrypy.config.update(
            {
                "server.socket_host": "127.0.0.1",
                "server.socket_port": 8080,
            }
        )

        # Start the server
        cherrypy.quickstart(self)

    @cherrypy.expose
    def index(self, state, code=None, error=None):
        """
        Receive a Fitbit response containing a verification code. Use the code
        to fetch the access_token.
        """
        error = None
        if code:
            try:
                self.fitbit.client.fetch_access_token(code)
            except MissingTokenError:
                error = self._fmt_failure(
                    "Missing access token parameter.</br>Please check that "
                    "you are using the correct client_secret"
                )
            except MismatchingStateError:
                error = self._fmt_failure("CSRF Warning! Mismatching state")
        else:
            error = self._fmt_failure("Unknown error while authenticating")

        # Shutdown the server
        threading.Timer(1, cherrypy.engine.exit).start()

        if error:
            return error
        else:
            return self.success_html

    def _fmt_failure(self, message):
        tb = traceback.format_tb(sys.exc_info()[2])
        tb_html = "<pre>%s</pre>" % ("\n".join(tb)) if tb else ""
        return self.failure_html % (message + tb_html)


if __name__ == "__main__":
    load_dotenv()

    client_id = os.getenv("FITBIT_CLIENT_ID")
    client_secret = os.getenv("FITBIT_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("Please set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET in your .env file.")
        print("Or enter them below:")

        if not client_id:
            client_id = input("Client ID: ").strip()
        if not client_secret:
            client_secret = input("Client Secret: ").strip()

    # Check if we already have tokens
    access_token = os.getenv("FITBIT_ACCESS_TOKEN")
    refresh_token = os.getenv("FITBIT_REFRESH_TOKEN")

    if access_token and refresh_token:
        print("Found existing tokens in .env. Verifying...")

        def refresh_cb(token):
            """Callback to update .env with new tokens if refreshed."""
            print("Token refreshed. Updating .env...")
            env_file = ".env"
            set_key(env_file, "FITBIT_ACCESS_TOKEN", token["access_token"])
            set_key(env_file, "FITBIT_REFRESH_TOKEN", token["refresh_token"])
            print("Updated .env with new tokens.")

        try:
            client = Fitbit(
                client_id,
                client_secret,
                access_token=access_token,
                refresh_token=refresh_token,
                refresh_cb=refresh_cb,
            )
            # Make a simple API call to check validity
            client.user_profile_get()
            print("Tokens are valid! No need to re-authorize.")
            sys.exit(0)
        except Exception as e:
            print(f"Token verification failed: {e}")
            print("Proceeding to full re-authorization...")

    server = OAuth2Server(client_id, client_secret)
    server.browser_authorize()

    access_token = server.fitbit.client.session.token["access_token"]
    refresh_token = server.fitbit.client.session.token["refresh_token"]

    print("\n--- AUTHORIZATION COMPLETE ---\n")
    print(f'ACCESS_TOKEN = "{access_token}"')
    print(f'REFRESH_TOKEN = "{refresh_token}"')
    print(f'CLIENT_ID = "{client_id}"')
    print(f'CLIENT_SECRET = "{client_secret}"')

    print("\nUpdating .env file...")
    env_file = ".env"
    set_key(env_file, "FITBIT_CLIENT_ID", client_id)
    set_key(env_file, "FITBIT_CLIENT_SECRET", client_secret)
    set_key(env_file, "FITBIT_ACCESS_TOKEN", access_token)
    set_key(env_file, "FITBIT_REFRESH_TOKEN", refresh_token)
    print(f"Successfully updated {env_file} with your credentials.")

import Eris from "eris/esm";
import colors from "colors";
import { env } from "../env";
import { lstatSync, readdirSync } from "fs";
import { join } from "path";
import { ApplicationCommand, AutocompleteInteraction, Client, CommandInteraction, ComponentInteraction, Role } from "eris";
import { channels } from "../config";

export interface CustomClient extends Client {
    commands: Map<string, any>;
}

const client = Eris(env.DISCORD_TOKEN ?? "", {
    intents: [],
}) as CustomClient;
client.commands = new Map();

const subCommandNaming = (parent: string, child: string) => `${parent}-${child}`.toLowerCase();

const createSubCommand = (name: string, description: string, command: ApplicationCommand[]) => {
    return {
        type: 1,
        name,
        description,
        options: command.map((x) => ({
            ...x,
            type: 1,
        })),
    };
};

client.on("guildMemberAdd", async (member) => {
    console.log(member);
    const role = client.guilds.get(env.GUILD_ID ?? "")?.roles.find((x) => x.id === "950964334983520257");
    console.log(role);
    if (!role) {
        return;
    }
    member.roles.add(role);
});

client.on("guildMemberRemove", async (member) => {
    console.log(colors.gray(`Member ${member.name} has left the server.`));
});

client.on("ready", async () => {
    console.log(colors.green("Bot is ready!"));

    const commands = await client.getCommands();
    if (commands.length) return;

    client.createCommand = (command: ApplicationCommand) => {
        return client.createGuildCommand(env.GUILD_ID ?? "", command);
    };

    client.bulkEditCommands = (commands: ApplicationCommand[]) => {
        return client.bulkEditGuildCommands(env.GUILD_ID ?? "", commands);
    };

    // launch all commands from commands folder
    readdirSync(join(import.meta.dir, "./commands")).forEach((file) => {
        // check if file is a folder (if it is make it a subcommand)
        if (lstatSync(join(import.meta.dir, `./commands/${file}`)).isDirectory()) {
            const subcommands: ApplicationCommand[] = [];
            readdirSync(join(import.meta.dir, `./commands/${file}`)).forEach((subfile) => {
                const command = require(`./commands/${file}/${subfile}`).default;
                if (command.setup) {
                    command.setup(client);
                    client.commands.set(command.name, command);

                    console.log(colors.gray(`Loaded command ${file}/${subfile} ${command.name}`));
                } else {
                    subcommands.push(command.schema);
                    client.commands.set(subCommandNaming(file, command.name), command);
                }
            });

            const command = createSubCommand(file, "Subcommand", subcommands);
            client.createCommand(command as any);
            return;
        }

        const command = require(`./commands/${file}`).default;
        command.setup(client);
        client.commands.set(command.name, command);
        console.log(`Loaded command ${file} ${command.name}`);
    });
});

client.on("interactionCreate", async (interaction) => {
    if (interaction instanceof ComponentInteraction) {
        if (!interaction.member?.roles.includes(env.ADMIN_ROLE_ID ?? "")) return;

        const message = await client.getMessage(interaction.message.channel.id, interaction.message.id);
        const posibleName: string[] = [];
        message.referencedMessage?.components?.forEach((x) => {
            x.components.map((y) => {
                if ("custom_id" in y) {
                    posibleName.push(y.custom_id);
                }
            });
        });

        const name = posibleName[0] || interaction?.message?.interaction?.name.split(" ").join("-").toLowerCase() || interaction.data.custom_id.split(" ").join("-").toLowerCase();

        if (client.commands.has(name)) return client.commands.get(name).onInteraction(client, interaction);
    }

    if (interaction instanceof AutocompleteInteraction) {
        if (!interaction.member?.roles.includes(env.ADMIN_ROLE_ID ?? "")) return;

        let name = interaction.data.name;
        if (interaction.data.options && interaction.data.options[0].type === 1) {
            name = subCommandNaming(name, interaction.data.options[0].name);
        }

        if (client.commands.has(name)) return client.commands.get(name).autocomplete(client, interaction);
    }

    if (interaction instanceof CommandInteraction) {
        // check if the command required admin role
        if (!interaction.member?.roles.includes(env.ADMIN_ROLE_ID ?? "")) return;

        let name = interaction.data.name;
        if (interaction.data.options && interaction.data.options[0].type === 1) {
            name = subCommandNaming(name, interaction.data.options[0].name);
        }

        if (client.commands.has(name)) return client.commands.get(name).on(client, interaction);
        switch (interaction.data.name) {
            case "ping":
                return interaction.createMessage(`Pong!`);
            default: {
                return interaction.createMessage("interaction recieved: " + interaction.data.name);
            }
        }
    }
});

client.on("error", (err: Error) => {
    console.error(err);
});

// Websocket related
const maxReconnectAttempts = 20;
let reconnectAttempts = 0;

function connectWebSocket() {
    const socket = new WebSocket("ws://localhost:3061/data", {
        headers: {
            "client-name": "anify-backend",
        },
    });

    socket.addEventListener("message", (event) => {
        try {
            const data = JSON.parse(String(event.data));

            if (data.key) {
                console.log(data);
                client.createMessage(channels.logs, {
                    embeds: [
                        {
                            title: "Key has been updated!",
                            description: `\`\`\`${JSON.stringify(data, null, 2)}\`\`\``,
                        },
                    ],
                });
            } else {
                client.createMessage(channels.logs, {
                    embeds: [
                        {
                            title: data.title.english ?? data.title.romaji ?? data.title.native ?? "Unknown Title",
                            description: `\`\`\`${data.description?.replace(/<[^>]*>?/gm, "")?.substring(0, 4000) ?? "No description provided."}\`\`\``,
                            color: Number(data.color) ?? 0x000000,
                            author: {
                                name: data.author ?? data.publisher ?? data.season?.toLowerCase(),
                                icon_url: data.coverImage ?? "https://anify.tv/favicon.ico",
                                url: "https://anify.tv",
                            },
                            url: data.mappings.find((x: any) => x.providerId === "anilist")?.id ? `https://anilist.co/${data.type?.toLowerCase()}/${data.mappings.find((x: any) => x.providerId === "anilist")?.id}` : data.mappings.find((x: any) => x.providerId === "mangadex")?.id ? `https://mangadex.org/title/${data.mappings.find((x: any) => x.providerId === "mangadex")?.id}` : `https://anify.tv/info/${data.id}`,
                            fields: [
                                {
                                    name: data.type === "ANIME" ? "Season" : "Country",
                                    value: data.type === "ANIME" ? data.season?.toLowerCase() : data.countryOfOrigin,
                                    inline: true,
                                },
                                {
                                    name: "Status",
                                    value: data.status?.toLowerCase(),
                                    inline: true,
                                },
                                {
                                    name: data.type === "ANIME" ? "Episodes" : "Chapters",
                                    value: data.type === "ANIME" ? data.totalEpisodes?.toString() : data.totalChapters?.toString(),
                                    inline: true,
                                },
                                {
                                    name: "Genres",
                                    value: `\`${data.genres?.slice(0, 4).join(", ")}\``,
                                    inline: true,
                                },
                                {
                                    name: "Tags",
                                    value: `\`${data.tags?.slice(0, 5).join(", ")}\``,
                                    inline: true,
                                },
                                {
                                    name: "Format",
                                    value: data.format?.toLowerCase(),
                                    inline: true,
                                },
                                {
                                    name: "Rating",
                                    value: `\`${data.averageRating?.toString()}/10\``,
                                    inline: true,
                                },
                                {
                                    name: "Popularity",
                                    value: `\`${data.averagePopularity?.toString()}\``,
                                    inline: true,
                                },
                            ],
                            image: {
                                url: data.coverImage ?? "https://anify.tv/favicon.ico",
                            },
                            thumbnail: {
                                url: data.bannerImage ?? "https://anify.tv/favicon.ico",
                            },
                        },
                    ],
                });
            }
        } catch (e) {
            console.log(e);
        }
    });

    socket.addEventListener("open", (event) => {
        console.log(colors.green("Connected to backend websocket."));
        reconnectAttempts = 0;
    });

    socket.addEventListener("close", (event) => {
        console.log(colors.red("Disconnected from backend websocket."));
        if (reconnectAttempts < maxReconnectAttempts) {
            setTimeout(connectWebSocket, 10000); // Try to reconnect every 10 seconds.
            reconnectAttempts++;
            console.log(colors.yellow(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`));
        }
    });

    socket.addEventListener("error", (event) => {
        console.log(colors.red("Error with websocket."));
        console.log(event);
    });
}

client.connect().catch(console.error);
connectWebSocket();

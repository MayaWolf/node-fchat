import {decodeHTML} from './common';
import {Channel as Interfaces, Character, Connection} from './interfaces';

export function queuedJoin(this: void, channels: string[]): void {
    const timer: NodeJS.Timer = setInterval(() => {
        const channel = channels.shift();
        if(channel === undefined) return clearInterval(timer);
        state.join(channel);
    }, 100);
}

function sortMember(this: void | never, array: Interfaces.Member[], member: Interfaces.Member): void {
    const name = member.character.name;
    let i = 0;
    for(; i < array.length; ++i) {
        const other = array[i];
        if(other.character.isChatOp && !member.character.isChatOp) continue;
        if(member.character.isChatOp && !other.character.isChatOp) break;
        if(other.rank > member.rank) continue;
        if(member.rank > other.rank) break;
        if(name < other.character.name) break;
    }
    array.splice(i, 0, member);
}

class Channel implements Interfaces.Channel {
    description = '';
    opList: string[];
    owner = '';
    mode: Interfaces.Mode = 'both';
    members: {[key: string]: {character: Character, rank: Interfaces.Rank} | undefined} = {};
    sortedMembers: Interfaces.Member[] = [];

    constructor(readonly id: string, readonly name: string) {
    }

    addMember(member: Interfaces.Member): void {
        this.members[member.character.name] = member;
        sortMember(this.sortedMembers, member);
    }

    removeMember(name: string): void {
        const member = this.members[name];
        if(member !== undefined) {
            delete this.members[name];
            this.sortedMembers.splice(this.sortedMembers.indexOf(member), 1);
        }
    }

    reSortMember(member: Interfaces.Member): void {
        this.sortedMembers.splice(this.sortedMembers.indexOf(member), 1);
        sortMember(this.sortedMembers, member);
    }

    createMember(character: Character): {character: Character, rank: Interfaces.Rank} {
        return {
            character,
            rank: this.owner === character.name ? Interfaces.Rank.Owner :
                this.opList.indexOf(character.name) !== -1 ? Interfaces.Rank.Op : Interfaces.Rank.Member
        };
    }
}

class ListItem implements Interfaces.ListItem {
    isJoined = false;

    constructor(readonly id: string, readonly name: string, public memberCount: number) {
    }
}

class State implements Interfaces.State {
    officialChannels: {readonly [key: string]: ListItem | undefined} = {};
    openRooms: {readonly [key: string]: ListItem | undefined} = {};
    joinedChannels: Channel[] = [];
    handlers: Interfaces.EventHandler[] = [];
    joinedKeys: {[key: string]: number | undefined} = {};

    constructor(private connection: Connection) {
    }

    join(channel: string): void {
        this.connection.send('JCH', {channel});
    }

    leave(channel: string): void {
        this.connection.send('LCH', {channel});
    }

    addChannel(channel: Channel): void {
        this.joinedKeys[channel.id] = this.joinedChannels.length;
        this.joinedChannels.push(channel);
        for(const handler of this.handlers) handler('join', channel);
    }

    removeChannel(channel: Channel): void {
        this.joinedChannels.splice(this.joinedKeys[channel.id]!, 1);
        delete this.joinedKeys[channel.id];
        for(const handler of this.handlers) handler('leave', channel);
    }

    getChannelItem(id: string): ListItem | undefined {
        id = id.toLowerCase();
        return (id.substr(0, 4) === 'adh-' ? this.openRooms : this.officialChannels)[id];
    }

    onEvent(handler: Interfaces.EventHandler): void {
        this.handlers.push(handler);
    }

    getChannel(id: string): Channel | undefined {
        const key = this.joinedKeys[id.toLowerCase()];
        return key !== undefined ? this.joinedChannels[key] : undefined;
    }
}

let state: State;

export default function(this: void, connection: Connection, characters: Character.State): Interfaces.State {
    state = new State(connection);
    let getChannelTimer: NodeJS.Timer | undefined;
    connection.onEvent('connecting', () => {
        state.joinedChannels = [];
        state.joinedKeys = {};
    });
    connection.onEvent('connected', (isReconnect) => {
        if(isReconnect) queuedJoin(Object.keys(state.joinedChannels));
        const getChannels = () => {
            connection.send('CHA');
            connection.send('ORS');
        };
        getChannels();
        if(getChannelTimer !== undefined) clearInterval(getChannelTimer);
        getChannelTimer = setInterval(getChannels, 60000);
    });

    connection.onMessage('CHA', (data) => {
        const channels: {[key: string]: ListItem} = {};
        for(const channel of data.channels) {
            const id = channel.name.toLowerCase();
            const item = new ListItem(id, channel.name, channel.characters);
            if(state.joinedKeys[id] !== undefined) item.isJoined = true;
            channels[id] = item;
        }
        state.officialChannels = channels;
    });
    connection.onMessage('ORS', (data) => {
        const channels: {[key: string]: ListItem} = {};
        for(const channel of data.channels) {
            const id = channel.name.toLowerCase();
            const item = new ListItem(id, decodeHTML(channel.title), channel.characters);
            if(state.joinedKeys[id] !== undefined) item.isJoined = true;
            channels[id] = item;
        }
        state.openRooms = channels;
    });
    connection.onMessage('JCH', (data) => {
        const item = state.getChannelItem(data.channel);
        if(data.character.identity === connection.character) {
            state.addChannel(new Channel(data.channel.toLowerCase(), decodeHTML(data.title)));
            if(item !== undefined) item.isJoined = true;
        } else {
            const channel = state.getChannel(data.channel)!;
            channel.addMember(channel.createMember(characters.get(data.character.identity)));
            if(item !== undefined) item.memberCount++;
        }
    });
    connection.onMessage('ICH', (data) => {
        const channel = state.getChannel(data.channel)!;
        channel.mode = data.mode;
        const members: {[key: string]: Interfaces.Member} = {};
        const sorted: Interfaces.Member[] = [];
        for(const user of data.users) {
            const name = user.identity;
            const member = channel.createMember(characters.get(name));
            members[name] = member;
            sortMember(sorted, member);
        }
        channel.members = members;
        channel.sortedMembers = sorted;
        const item = state.getChannelItem(data.channel);
        if(item !== undefined) item.memberCount = data.users.length;
    });
    connection.onMessage('CDS', (data) => state.getChannel(data.channel)!.description = decodeHTML(data.description));
    connection.onMessage('LCH', (data) => {
        const channel = state.getChannel(data.channel);
        if(channel === undefined) return;
        const item = state.getChannelItem(data.channel);
        if(data.character === connection.character) {
            state.removeChannel(channel);
            if(item !== undefined) item.isJoined = false;
        } else {
            channel.removeMember(data.character);
            if(item !== undefined) item.memberCount--;
        }
    });
    connection.onMessage('COA', (data) => {
        const channel = state.getChannel(data.channel)!;
        channel.opList.push(data.character);
        const member = channel.members[data.character];
        if(member === undefined || member.rank === Interfaces.Rank.Owner) return;
        member.rank = Interfaces.Rank.Op;
        channel.reSortMember(member);
    });
    connection.onMessage('COL', (data) => {
        const channel = state.getChannel(data.channel)!;
        channel.owner = data.oplist[0];
        channel.opList = data.oplist.slice(1);
    });
    connection.onMessage('COR', (data) => {
        const channel = state.getChannel(data.channel)!;
        channel.opList.splice(channel.opList.indexOf(data.character), 1);
        const member = channel.members[data.character];
        if(member === undefined || member.rank === Interfaces.Rank.Owner) return;
        member.rank = Interfaces.Rank.Member;
        channel.reSortMember(member);
    });
    connection.onMessage('CSO', (data) => {
        const channel = state.getChannel(data.channel)!;
        const oldOwner = channel.members[channel.owner];
        if(oldOwner !== undefined) {
            oldOwner.rank = Interfaces.Rank.Member;
            channel.reSortMember(oldOwner);
        }
        channel.owner = data.character;
        const newOwner = channel.members[data.character];
        if(newOwner !== undefined) {
            newOwner.rank = Interfaces.Rank.Owner;
            channel.reSortMember(newOwner);
        }
    });
    connection.onMessage('RMO', (data) => state.getChannel(data.channel)!.mode = data.mode);
    connection.onMessage('FLN', (data) => {
        for(const key in state.joinedKeys)
            state.getChannel(key)!.removeMember(data.character);
    });
    const globalHandler = (data: Connection.ServerCommands['AOP'] | Connection.ServerCommands['DOP']) => {
        //tslint:disable-next-line:forin
        for(const key in state.joinedKeys) {
            const channel = state.getChannel(key)!;
            const member = channel.members[data.character];
            if(member !== undefined) channel.reSortMember(member);
        }
    };
    connection.onMessage('AOP', globalHandler);
    connection.onMessage('DOP', globalHandler);
    return state;
}